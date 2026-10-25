/**
 * Settings dialog tabs (DESIGN §9).
 *
 * Single source of truth for the tab ids and labels shared by the settings
 * dialog and the command palette ("Configurações › Dados"). Icons stay in the
 * UI layer (`components/settings`) because they are presentation-only.
 */

export type SettingsTabId =
  | 'general'
  | 'providers'
  | 'model'
  | 'instructions'
  | 'tools'
  | 'data'
  | 'about';

export interface SettingsTabDefinition {
  id: SettingsTabId;
  label: string;
}

export const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
  { id: 'general', label: 'Geral' },
  { id: 'providers', label: 'Provedores' },
  { id: 'model', label: 'Modelo padrão' },
  { id: 'instructions', label: 'Instruções' },
  { id: 'tools', label: 'Ferramentas' },
  { id: 'data', label: 'Dados' },
  { id: 'about', label: 'Sobre' },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'general';

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((tab) => tab.id));

/** Narrows an untrusted value (rehydrated state, URL, test) to a valid tab id. */
export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === 'string' && SETTINGS_TAB_IDS.has(value);
}
