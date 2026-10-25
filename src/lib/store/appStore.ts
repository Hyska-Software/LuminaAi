import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api';
import { defaultReasoningFor, defaultSelection, getModel, getProvider } from '../catalog';
import type {
  AppInfo,
  ModelSelection,
  ProviderInfo,
  ProviderKeyStatus,
  ProviderValidation,
  ReasoningSelection,
  Settings,
  SettingsView,
} from '../types';

/** Upper bound accepted for the agent loop steps per turn. */
export const MAX_STEPS_LIMIT = 1000;

/** Default number of agent loop steps per turn (fresh installs). */
export const MAX_STEPS_DEFAULT = 64;

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  locale: 'pt-BR',
  defaultProvider: 'opencode-go',
  defaultModel: 'deepseek-v4.1-flash',
  reasoningDefault: 'max',
  systemPrompt: '',
  webSearchEnabled: true,
  fileCreationEnabled: true,
  maxSteps: MAX_STEPS_DEFAULT,
  sendKey: 'enter',
  showTokenUsage: true,
  reduceMotion: false,
  fontScale: 1,
  temperature: null,
  includeAttachments: true,
  autoTitle: true,
  codeExecutionEnabled: false,
  codeTimeoutSecs: 120,
  codePythonPath: '',
  codeNodePath: '',
  skillsPanelEnabled: true,
  disabledSkills: [],
};

interface AppState {
  ready: boolean;
  initializing: boolean;
  appInfo: AppInfo | null;
  settings: Settings;
  keys: ProviderKeyStatus[];
  providers: ProviderInfo[];
  selection: ModelSelection;
  favorites: string[];
  error: string | null;
  catalogRefreshedAt: number | null;

  init: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /**
   * Reloads settings from the backend without touching the catalog/model
   * selection. Used after commands that mutate settings server-side (e.g.
   * skill enable/disable) so a later full save cannot clobber the change.
   */
  reloadSettings: () => Promise<void>;
  setProviderKey: (providerId: string, key: string | null) => Promise<void>;
  setSelection: (selection: ModelSelection) => void;
  /**
   * Updates the active selection without touching the persisted defaults.
   * Used when opening an existing conversation (its model is locked in) and
   * when "Novo chat" resets to the configured defaults.
   */
  setActiveSelection: (selection: ModelSelection) => void;
  setReasoning: (reasoning: ReasoningSelection | null) => void;
  toggleFavorite: (modelId: string) => void;
  isFavorite: (modelId: string) => boolean;
  refreshCatalog: () => Promise<void>;
  validateProvider: (providerId: string) => Promise<ProviderValidation>;
  setError: (error: string | null) => void;
}

function keysFromView(view: SettingsView): ProviderKeyStatus[] {
  return view.keys;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ready: false,
      initializing: false,
      appInfo: null,
      settings: DEFAULT_SETTINGS,
      keys: [],
      providers: [],
      selection: defaultSelection(DEFAULT_SETTINGS),
      favorites: ['glm-5.3-flash', 'claude-haiku-5-5', 'gpt-6-luna', 'kimi-k3'],
      error: null,
      catalogRefreshedAt: null,

      init: async () => {
        if (get().initializing) return;
        set({ initializing: true, error: null });
        try {
          const [view, catalogView, info] = await Promise.all([
            api.getSettings(),
            api.getCatalog(),
            api.appInfo().catch(() => null),
          ]);
          const settings = view.settings;
          const persisted = get().selection;
          const fallback = defaultSelection(settings);
          const candidateProvider = persisted?.providerId ?? fallback.providerId;
          const provider = getProvider(candidateProvider) ?? getProvider(fallback.providerId);
          const modelId =
            persisted?.modelId && provider?.models.some((m) => m.id === persisted.modelId)
              ? persisted.modelId
              : fallback.modelId;
          const model = getModel(provider?.id ?? fallback.providerId, modelId);
          const reasoning =
            persisted?.reasoning && persisted.providerId === provider?.id && persisted.modelId === modelId
              ? persisted.reasoning
              : defaultReasoningFor(model);

          set({
            ready: true,
            initializing: false,
            settings,
            keys: keysFromView(view),
            providers: catalogView.catalog.providers,
            appInfo: info,
            selection: { providerId: provider?.id ?? fallback.providerId, modelId, reasoning },
            catalogRefreshedAt: catalogView.remoteRefreshedAt ?? null,
          });
        } catch (error) {
          set({ initializing: false, error: error instanceof Error ? error.message : String(error) });
        }
      },

      saveSettings: async (patch) => {
        const next: Settings = { ...get().settings, ...patch };
        set({ settings: next });
        try {
          const view = await api.saveSettings(next);
          set({ settings: view.settings, keys: view.keys });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error) });
        }
      },

      reloadSettings: async () => {
        try {
          const view = await api.getSettings();
          set({ settings: view.settings, keys: view.keys });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error) });
        }
      },

      setProviderKey: async (providerId, key) => {
        try {
          const view = await api.setProviderKey(providerId, key);
          set({ keys: view.keys });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error) });
        }
      },

      setSelection: (selection) => {
        set({ selection });
        const settings = get().settings;
        if (settings.defaultProvider !== selection.providerId || settings.defaultModel !== selection.modelId) {
          void get().saveSettings({ defaultProvider: selection.providerId, defaultModel: selection.modelId });
        }
      },

      setReasoning: (reasoning) => set((state) => ({ selection: { ...state.selection, reasoning } })),

      setActiveSelection: (selection) => set({ selection }),

      toggleFavorite: (modelId) =>
        set((state) => ({
          favorites: state.favorites.includes(modelId)
            ? state.favorites.filter((id) => id !== modelId)
            : [modelId, ...state.favorites],
        })),

      isFavorite: (modelId) => get().favorites.includes(modelId),

      refreshCatalog: async () => {
        try {
          const catalogView = await api.refreshCatalog();
          set({
            providers: catalogView.catalog.providers,
            keys: catalogView.keys,
            catalogRefreshedAt: catalogView.remoteRefreshedAt ?? Date.now(),
          });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error) });
        }
      },

      validateProvider: (providerId) => api.validateProvider(providerId),

      setError: (error) => set({ error }),
    }),
    {
      name: 'lumina.app',
      partialize: (state) => ({ selection: state.selection, favorites: state.favorites }),
    },
  ),
);
