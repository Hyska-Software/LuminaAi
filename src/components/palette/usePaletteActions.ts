/**
 * Single source of truth for the command palette catalog
 * (docs/COMMAND_PALETTE.md §5). Availability is resolved here: context-only
 * commands are simply absent when they cannot run, so the palette never offers
 * a dead end.
 */
import {
  ArrowLeft,
  Braces,
  Code,
  Copy,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Library,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  PanelLeft,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  SunMoon,
  Terminal,
  TextCursorInput,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { conversationCitations } from '@/lib/citations';
import { SETTINGS_TABS } from '@/lib/settingsTabs';
import { SETTINGS_TAB_ICONS } from '@/components/settings/tabIcons';
import {
  MODEL_LOCKED_DESCRIPTION,
  MODEL_LOCKED_TITLE,
  resolveDark,
  selectModelLocked,
  useAppStore,
  useChatStore,
  useUiStore,
} from '@/lib/store';
import type { SettingsTabId } from '@/lib/settingsTabs';
import type { ChatMessage } from '@/lib/types';
import type { PaletteAction } from '@/lib/palette/types';
import { copyText, modKey, truncate } from '@/lib/utils';

/** Copy shared by the settings tab commands (DESIGN §9). */
const SETTINGS_TAB_DESCRIPTIONS: Record<SettingsTabId, string> = {
  general: 'Tema, idioma e tamanho do texto',
  providers: 'Chaves de API e status dos provedores',
  model: 'Modelo e modo de pensamento padrão',
  instructions: 'Instruções do sistema',
  tools: 'Busca web, criação de arquivos, execução e passos',
  data: 'Pasta de dados, exportação e limpeza',
  about: 'Versão e informações do aplicativo',
};

function lastAssistantMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
}

function currentActiveMessages(): ChatMessage[] {
  const chat = useChatStore.getState();
  return chat.activeId ? (chat.messagesByConversation[chat.activeId] ?? []) : [];
}

async function copyLastAnswer(): Promise<void> {
  const last = lastAssistantMessage(currentActiveMessages());
  if (!last) {
    toast.info('Nenhuma resposta para copiar ainda');
    return;
  }
  const ok = await copyText(last.content);
  if (ok) toast.success('Resposta copiada');
  else toast.error('Não foi possível copiar');
}

async function exportActiveConversation(format: 'markdown' | 'json'): Promise<void> {
  const conversationId = useChatStore.getState().activeId;
  if (!conversationId) {
    toast.info('Nenhuma conversa aberta');
    return;
  }
  try {
    const path = await api.exportConversation(conversationId, format);
    if (path) toast.success('Conversa exportada', { description: path });
  } catch (error) {
    toast.error('Não foi possível exportar', { description: String(error) });
  }
}

function setTheme(theme: 'light' | 'dark' | 'system'): void {
  const ui = useUiStore.getState();
  ui.setTheme(theme);
  void useAppStore.getState().saveSettings({ theme });
}

function toggleTheme(): void {
  setTheme(resolveDark(useUiStore.getState().theme) ? 'light' : 'dark');
}

function toggleSetting(
  key: 'webSearchEnabled' | 'fileCreationEnabled' | 'codeExecutionEnabled',
  label: string,
): void {
  const app = useAppStore.getState();
  const next = !app.settings[key];
  void app.saveSettings({ [key]: next });
  toast.success(`${label} ${next ? 'ativada' : 'desativada'}`);
}

function focusComposer(): void {
  const ui = useUiStore.getState();
  // The composer lives in the single ChatView instance shared by both layouts;
  // when another surface replaces the conversation, go back to it first and
  // focus once the composer is visible again.
  const hidden =
    ui.layoutMode === 'code' ? ui.codeView !== 'session' : ui.activeView !== 'chat';
  if (!hidden) {
    window.dispatchEvent(new CustomEvent('lumina:focus-composer'));
    return;
  }
  if (ui.layoutMode === 'code') ui.setCodeView('session');
  else ui.setActiveView('chat');
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('lumina:focus-composer'));
  }, 0);
}

function openSkills(): void {
  const ui = useUiStore.getState();
  if (ui.layoutMode === 'code') ui.setCodeView('skills');
  else ui.setActiveView('skills');
}

function openArtifacts(): void {
  const ui = useUiStore.getState();
  if (!ui.artifacts.length) {
    toast.info('Nenhum artefato nesta conversa');
    return;
  }
  ui.openArtifactList();
}

/**
 * Biblioteca commands (PLAN §4.3): the view replaces the chat column, so the
 * palette closes, the view mounts and only then is the native picker requested
 * through the `lumina:library-import` event (one tick later, when the listener
 * is already attached).
 */
function openLibrary(): void {
  useUiStore.getState().setActiveView('library');
}

function importFilesToLibrary(): void {
  useUiStore.getState().setActiveView('library');
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('lumina:library-import'));
  }, 0);
}

function openSources(): void {
  const count = conversationCitations(currentActiveMessages()).length;
  if (count === 0) {
    toast.info('Nenhuma fonte nesta conversa');
    return;
  }
  useUiStore.getState().openSourcesPanel();
}

function openDataDir(): void {
  void api.openDataDir().catch((error: unknown) => {
    toast.error('Não foi possível abrir a pasta de dados', { description: String(error) });
  });
}

function openSkillsDir(): void {
  void api.openSkillsDir().catch((error: unknown) => {
    toast.error('Não foi possível abrir a pasta de skills', { description: String(error) });
  });
}

function refreshCatalog(): void {
  void useAppStore
    .getState()
    .refreshCatalog()
    .then(() => {
      const error = useAppStore.getState().error;
      if (error) {
        toast.error('Não foi possível atualizar o catálogo', { description: error });
        return;
      }
      toast.success('Catálogo de modelos atualizado');
    });
}

function togglePinnedConversation(): void {
  const chat = useChatStore.getState();
  const conversation = chat.conversations.find((entry) => entry.id === chat.activeId);
  if (!conversation) return;
  void chat.togglePinned(conversation.id);
  toast.success(conversation.pinned ? 'Conversa desafixada' : 'Conversa fixada', {
    description: truncate(conversation.title, 60),
  });
}

function switchModel(locked: boolean): void {
  if (locked) {
    toast.info(MODEL_LOCKED_TITLE, { description: MODEL_LOCKED_DESCRIPTION });
    return;
  }
  useUiStore.getState().setModelPickerOpen(true);
}

/**
 * Builds the palette commands for the current context. Reading every dependency
 * through selectors keeps the palette reactive (streaming start/stop, new
 * attachments, theme/tool changes, conversation switch).
 */
export function usePaletteActions(): PaletteAction[] {
  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const messages = useChatStore((state) =>
    state.activeId ? state.messagesByConversation[state.activeId] : undefined,
  );
  const streaming = useChatStore((state) => state.streaming !== null);
  const pendingAttachments = useChatStore((state) => state.pendingAttachments);
  const locked = useChatStore(selectModelLocked);

  const settings = useAppStore((state) => state.settings);
  const theme = useUiStore((state) => state.theme);
  const activeView = useUiStore((state) => state.activeView);
  const layoutMode = useUiStore((state) => state.layoutMode);
  const codeView = useUiStore((state) => state.codeView);
  const artifacts = useUiStore((state) => state.artifacts);

  const activeConversation = conversations.find((entry) => entry.id === activeId);
  const activeMessages = messages ?? [];
  const lastAssistant = lastAssistantMessage(activeMessages);
  const lastUser = [...activeMessages].reverse().find((message) => message.role === 'user');
  const citations = conversationCitations(activeMessages);
  const dark = resolveDark(theme);
  const actions: PaletteAction[] = [];

  /* -------- Conversas -------- */
  actions.push({
    id: 'nova-conversa',
    group: 'conversas',
    label: layoutMode === 'code' ? 'Novo agente' : 'Novo chat',
    description:
      layoutMode === 'code' ? 'Comece uma nova sessão no layout Code' : 'Comece uma conversa em branco',
    icon: MessageSquarePlus,
    shortcut: `${modKey}+N`,
    keywords:
      layoutMode === 'code'
        ? 'novo agente sessão code criar'
        : 'nova conversa criar blank',
    run: () => {
      if (layoutMode === 'code') {
        void useChatStore.getState().startNewConversation('code');
        return;
      }
      // A Chat session is created in the Chat namespace; make sure its layout
      // is the visible one.
      useUiStore.getState().setLayoutMode('chat');
      void useChatStore.getState().startNewConversation('chat');
    },
  });

  if (activeConversation) {
    actions.push({
      id: 'fixar-conversa',
      group: 'conversas',
      label: activeConversation.pinned ? 'Desafixar conversa' : 'Fixar conversa',
      description: truncate(activeConversation.title, 72),
      icon: activeConversation.pinned ? PinOff : Pin,
      keywords: 'pin fixar topo',
      run: togglePinnedConversation,
    });
    actions.push({
      id: 'exportar-markdown',
      group: 'conversas',
      label: 'Exportar conversa (Markdown)',
      description: 'Salvar a conversa atual em Markdown',
      icon: Download,
      keywords: 'salvar markdown arquivo',
      run: () => void exportActiveConversation('markdown'),
    });
    actions.push({
      id: 'exportar-json',
      group: 'conversas',
      label: 'Exportar conversa (JSON)',
      description: 'Salvar a conversa em formato estruturado',
      icon: Braces,
      keywords: 'salvar json dados backup',
      run: () => void exportActiveConversation('json'),
    });
  }

  if (lastAssistant) {
    actions.push({
      id: 'copiar-ultima-resposta',
      group: 'conversas',
      label: 'Copiar última resposta',
      description: 'Copia o texto da resposta mais recente',
      icon: Copy,
      keywords: 'copiar clipboard área de transferência',
      run: () => void copyLastAnswer(),
    });
  }

  if (pendingAttachments.length > 0) {
    actions.push({
      id: 'limpar-anexos',
      group: 'conversas',
      label: 'Limpar anexos',
      description:
        pendingAttachments.length === 1
          ? 'Remover 1 anexo pendente do composer'
          : `Remover ${pendingAttachments.length} anexos pendentes do composer`,
      icon: Trash2,
      keywords: 'arquivos remover composer',
      run: () => {
        useChatStore.getState().clearAttachments();
        toast.success('Anexos removidos');
      },
    });
  }

  if (streaming) {
    actions.push({
      id: 'parar-resposta',
      group: 'conversas',
      label: 'Parar resposta',
      description: 'Interrompe a resposta em andamento',
      icon: Square,
      keywords: 'cancelar stop interromper',
      run: () => void useChatStore.getState().stop(),
    });
  } else if (lastAssistant && lastUser) {
    actions.push({
      id: 'regenerar-resposta',
      group: 'conversas',
      label: 'Regenerar resposta',
      description: 'Gera novamente a última resposta',
      icon: RotateCcw,
      keywords: 'tentar de novo refazer',
      run: () => void useChatStore.getState().regenerate(),
    });
  }

  /* -------- Navegação -------- */
  actions.push({
    id: layoutMode === 'chat' ? 'modo-code' : 'modo-chat',
    group: 'navegacao',
    label: layoutMode === 'chat' ? 'Ir para o modo Code' : 'Ir para o modo Chat',
    description:
      layoutMode === 'chat'
        ? 'Abrir o workspace de código (sessões e alterações)'
        : 'Voltar ao layout de conversa com o assistente',
    icon: layoutMode === 'chat' ? Code : MessageSquare,
    keywords: 'layout modo code chat conversa workspace agente',
    run: () =>
      useUiStore.getState().setLayoutMode(layoutMode === 'chat' ? 'code' : 'chat'),
  });

  actions.push({
    id: 'focar-composer',
    group: 'navegacao',
    label: 'Focar campo de mensagem',
    description: 'Leva o cursor para o composer',
    icon: TextCursorInput,
    shortcut: `${modKey}+J`,
    keywords: 'input escrever mensagem',
    run: focusComposer,
  });
  actions.push({
    id: 'alternar-sidebar',
    group: 'navegacao',
    label: 'Alternar barra lateral',
    description: 'Mostrar ou ocultar o histórico',
    icon: PanelLeft,
    shortcut: `${modKey}+B`,
    keywords: 'sidebar histórico lateral',
    run: () => useUiStore.getState().toggleSidebar(),
  });

  // Artifacts/library/sources are Chat-layout surfaces: the Code workbench
  // replaces them with its Arquivos/Alterações panel, so the commands are
  // simply absent there (never a dead end — COMMAND_PALETTE §5).
  if (layoutMode === 'chat') {
    actions.push({
      id: 'abrir-artefatos',
      group: 'navegacao',
      label: 'Abrir painel de artefatos',
      description: artifacts.length
        ? `${artifacts.length} ${artifacts.length === 1 ? 'artefato' : 'artefatos'} nesta conversa`
        : 'Nenhum artefato nesta conversa',
      icon: FileText,
      keywords: 'arquivos canvas prévia preview',
      run: openArtifacts,
    });
    actions.push({
      id: 'abrir-fontes',
      group: 'navegacao',
      label: 'Abrir painel de fontes',
      description: citations.length
        ? `${citations.length} ${citations.length === 1 ? 'fonte' : 'fontes'} nesta conversa`
        : 'Nenhuma fonte nesta conversa',
      icon: Globe,
      keywords: 'citações links referências web',
      run: openSources,
    });
    actions.push({
      id: 'abrir-biblioteca',
      group: 'navegacao',
      label: 'Abrir biblioteca',
      description: 'Todos os arquivos das conversas e os enviados por você',
      icon: Library,
      keywords: 'biblioteca library arquivos favoritos upload enviados documentos',
      run: openLibrary,
    });
    actions.push({
      id: 'enviar-arquivos-biblioteca',
      group: 'navegacao',
      label: 'Enviar arquivos para a biblioteca',
      description: 'Importar arquivos do computador para usar no chat',
      icon: Upload,
      keywords: 'upload importar enviar arquivos biblioteca library anexar',
      run: importFilesToLibrary,
    });
  }

  if (settings.skillsPanelEnabled) {
    actions.push({
      id: 'gerenciar-skills',
      group: 'navegacao',
      label: 'Gerenciar skills',
      description: 'Ativar, desativar e excluir skills do agente',
      icon: Sparkles,
      keywords: 'skills habilidades agente',
      run: openSkills,
    });
    actions.push({
      id: 'abrir-pasta-skills',
      group: 'navegacao',
      label: 'Abrir pasta de skills',
      description: 'Abrir a pasta de skills do usuário',
      icon: FolderOpen,
      keywords: 'skills pasta arquivos',
      run: openSkillsDir,
    });
  }

  if (layoutMode === 'code') {
    if (codeView === 'skills') {
      actions.push({
        id: 'voltar-a-sessao',
        group: 'navegacao',
        label: 'Voltar à sessão',
        description: 'Sair da gestão de skills e voltar ao agente',
        icon: ArrowLeft,
        keywords: 'sessão agente voltar code',
        run: () => useUiStore.getState().setCodeView('session'),
      });
    }
  } else if (activeView === 'skills' || activeView === 'library') {
    actions.push({
      id: 'voltar-ao-chat',
      group: 'navegacao',
      label: 'Voltar ao chat',
      description: activeView === 'library' ? 'Sair da biblioteca' : 'Sair da gestão de skills',
      icon: ArrowLeft,
      keywords: 'chat conversa voltar',
      run: () => useUiStore.getState().setActiveView('chat'),
    });
  }

  actions.push({
    id: 'trocar-modelo',
    group: 'navegacao',
    label: locked ? MODEL_LOCKED_TITLE : 'Trocar modelo',
    description: locked ? MODEL_LOCKED_DESCRIPTION : 'Escolher modelo e modo de pensamento',
    icon: locked ? Lock : Sparkles,
    keywords: 'modelo raciocínio pensamento provider',
    run: () => switchModel(locked),
  });

  /* -------- Ferramentas -------- */
  actions.push({
    id: 'busca-web',
    group: 'ferramentas',
    label: settings.webSearchEnabled ? 'Desativar busca web' : 'Ativar busca web',
    description: settings.webSearchEnabled
      ? 'Ferramenta ativa no próximo turno'
      : 'Ferramenta desligada no composer',
    icon: Globe,
    keywords: 'web search internet pesquisa',
    checked: settings.webSearchEnabled,
    run: () => toggleSetting('webSearchEnabled', 'Busca web'),
  });
  actions.push({
    id: 'criar-arquivos',
    group: 'ferramentas',
    label: settings.fileCreationEnabled ? 'Desativar criação de arquivos' : 'Ativar criação de arquivos',
    description: settings.fileCreationEnabled
      ? 'Ferramenta ativa no próximo turno'
      : 'Ferramenta desligada no composer',
    icon: FilePlus,
    keywords: 'arquivos criar documentos artifacts',
    checked: settings.fileCreationEnabled,
    run: () => toggleSetting('fileCreationEnabled', 'Criação de arquivos'),
  });
  actions.push({
    id: 'executar-codigo',
    group: 'ferramentas',
    label: settings.codeExecutionEnabled ? 'Desativar execução de código' : 'Ativar execução de código',
    description: settings.codeExecutionEnabled
      ? 'run_code ativo no próximo turno'
      : 'run_code desligado nas configurações',
    icon: Terminal,
    keywords: 'código python node scripts run_code',
    checked: settings.codeExecutionEnabled,
    run: () => toggleSetting('codeExecutionEnabled', 'Execução de código'),
  });

  /* -------- Aparência -------- */
  actions.push({
    id: 'alternar-tema',
    group: 'aparencia',
    label: 'Alternar tema',
    description: `Tema atual: ${dark ? 'escuro' : 'claro'} — alterna para ${dark ? 'claro' : 'escuro'}`,
    icon: SunMoon,
    keywords: 'dark light escuro claro aparência',
    run: toggleTheme,
  });
  actions.push({
    id: 'tema-sistema',
    group: 'aparencia',
    label: 'Seguir tema do sistema',
    description: 'Usa a preferência de aparência do sistema operacional',
    icon: Monitor,
    keywords: 'sistema automático auto aparência',
    checked: theme === 'system',
    run: () => setTheme('system'),
  });

  /* -------- Configurações -------- */
  actions.push({
    id: 'abrir-configuracoes',
    group: 'configuracoes',
    label: 'Abrir configurações',
    description: 'Tema, provedores, modelo padrão e ferramentas',
    icon: Settings,
    shortcut: `${modKey}+,`,
    keywords: 'preferências ajustes settings',
    run: () => useUiStore.getState().openSettings(),
  });
  for (const tab of SETTINGS_TABS) {
    actions.push({
      id: `config-${tab.id}`,
      group: 'configuracoes',
      label: `Configurações › ${tab.label}`,
      description: SETTINGS_TAB_DESCRIPTIONS[tab.id],
      icon: SETTINGS_TAB_ICONS[tab.id],
      keywords: `configuracoes ajustes ${tab.label.toLowerCase()}`,
      run: () => useUiStore.getState().openSettings(tab.id),
    });
  }

  /* -------- Sistema -------- */
  actions.push({
    id: 'abrir-pasta-dados',
    group: 'sistema',
    label: 'Abrir pasta de dados',
    description: 'Banco, anexos e artefatos do Lumina',
    icon: FolderOpen,
    keywords: 'dados database arquivos pasta',
    run: openDataDir,
  });
  actions.push({
    id: 'recarregar-catalogo',
    group: 'sistema',
    label: 'Recarregar catálogo de modelos',
    description: 'Buscar a lista atualizada de modelos disponíveis',
    icon: RefreshCw,
    keywords: 'modelos catálogo atualizar refresh',
    run: refreshCatalog,
  });

  return actions;
}
