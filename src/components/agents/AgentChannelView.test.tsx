// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentChannels: vi.fn(),
  listAgentChannelMessages: vi.fn(),
  listAgentTasks: vi.fn(),
  postAgentChannelMessage: vi.fn(),
  importAttachments: vi.fn(),
  importClipboardAttachments: vi.fn(),
  deleteAttachment: vi.fn(),
}));

const dialog = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialog.open }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { useAgentStore, useUiStore } from '@/lib/store';
import type { Agent, AgentChannel, AttachmentInfo } from '@/lib/types';
import { AgentChannelView } from './AgentChannelView';

const channel: AgentChannel = {
  id: 'channel-1',
  name: 'Lançamento',
  kind: 'channel',
  memberIds: ['agent-1', 'agent-2'],
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: null,
};

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    role: '',
    description: '',
    avatar: { kind: 'emoji', value: '🤖', shape: 'rounded' },
    department: 'Geral',
    pinned: false,
    sortOrder: 0,
    providerId: 'opencode-go',
    modelId: 'glm-5.3-flash',
    reasoning: null,
    instructions: '',
    promptVersion: 1,
    starters: [],
    capabilities: {
      webSearch: true,
      fileAccess: true,
      codeExecution: true,
      skills: null,
      tools: null,
      mcpServers: null,
    },
    memoryEnabled: false,
    memoryRevision: 0,
    workspaceId: null,
    permissionMode: 'edit',
    dockerImage: null,
    computerEnvironment: 'auto',
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    threadCount: 0,
    lastActiveAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no scrolling implementation.
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  mocks.listAgentChannels.mockResolvedValue([channel]);
  mocks.listAgentChannelMessages.mockResolvedValue([]);
  mocks.listAgentTasks.mockResolvedValue([]);
  mocks.postAgentChannelMessage.mockResolvedValue({ messages: [], errors: [] });
  mocks.importAttachments.mockResolvedValue([]);
  mocks.importClipboardAttachments.mockResolvedValue([]);
  mocks.deleteAttachment.mockResolvedValue(undefined);
  dialog.open.mockResolvedValue(null);
  useAgentStore.setState({
    agentsById: { 'agent-1': agent('agent-1', 'Ana'), 'agent-2': agent('agent-2', 'Bia') },
    orderedIds: ['agent-1', 'agent-2'],
    status: 'ready',
    error: null,
  });
  useUiStore.setState({ activeChannelId: 'channel-1' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentChannelView mention picker', () => {
  it('sugere membros ao digitar @ e insere a menção', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');
    fireEvent.change(composer, { target: { value: 'oi @Bi' } });
    const option = await screen.findByRole('option', { name: 'Mencionar Bia' });
    fireEvent.mouseDown(option);
    await waitFor(() =>
      expect((composer as HTMLTextAreaElement).value).toBe('oi @Bia '),
    );
  });

  it('navega a menção por teclado e confirma sem publicar', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');
    fireEvent.change(composer, { target: { value: 'oi @' } });
    await screen.findByRole('option', { name: 'Mencionar Ana' });
    fireEvent.keyDown(composer, { key: 'ArrowDown' });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() =>
      expect((composer as HTMLTextAreaElement).value).toBe('oi @Bia '),
    );
    expect(mocks.postAgentChannelMessage).not.toHaveBeenCalled();
  });

  it('não mostra composer em uma conversa direta', async () => {
    mocks.listAgentChannels.mockResolvedValue([{ ...channel, kind: 'dm', name: 'DM · Ana ↔ Bia' }]);
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText(/Conversa direta entre agentes/)).toBeTruthy();
    expect(screen.queryByLabelText(/Mensagem para o canal/)).toBeNull();
  });
});

describe('AgentChannelView — chat parity', () => {
  it('mostra os agentes do grupo no topo do canal', async () => {
    const { container } = render(
      <AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />,
    );
    await screen.findByText('2 agentes · Ana, Bia');
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('Lançamento')).toBeTruthy();
    expect(header?.querySelectorAll('[data-avatar-kind]')).toHaveLength(2);
  });

  it('mostra o líder no header do canal', async () => {
    mocks.listAgentChannels.mockResolvedValue([{ ...channel, leaderAgentId: 'agent-1' }]);
    const { container } = render(
      <AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />,
    );
    await screen.findByText('Líder · Ana');
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('2 agentes · Ana, Bia')).toBeTruthy();
  });

  it('mostra o andamento das tarefas delegadas no canal', async () => {
    mocks.listAgentTasks.mockResolvedValue([
      {
        id: 'task-1',
        channelId: 'channel-1',
        parentTaskId: null,
        ownerAgentId: 'agent-2',
        createdByAgentId: 'agent-1',
        createdByUser: false,
        title: 'Resumir notícias de hoje',
        brief: 'Pesquise e resuma.',
        acceptance: '',
        status: 'running',
        priority: 0,
        maxTurns: 5,
        maxTokens: 5000,
        maxCost: 1,
        deadlineAt: null,
        conversationId: null,
        originConversationId: null,
        result: null,
        resultArtifactIds: [],
        leaseUntil: null,
        handoffCount: 0,
        version: 1,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText('Tarefas em andamento')).toBeTruthy();
    expect(screen.getByText('Resumir notícias de hoje')).toBeTruthy();
    expect(screen.getByText('Executando')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver quadro' })).toBeTruthy();
  });

  it('usa o composer do chat (envio redondo) sem seletor de modelos', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');
    expect(composer.getAttribute('placeholder')).toBe('Mensagem para #Lançamento…');
    expect(screen.getByRole('button', { name: 'Publicar no canal' })).toBeTruthy();
    // Each member agent owns its route; the channel must not expose a model pill.
    expect(screen.queryByRole('button', { name: /Selecionar modelo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Selecionar modo de pensamento/ })).toBeNull();
  });

  it('Enter publica e Shift+Enter quebra linha', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');
    fireEvent.change(composer, { target: { value: 'primeira linha' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(mocks.postAgentChannelMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() =>
      expect(mocks.postAgentChannelMessage).toHaveBeenCalledWith('channel-1', 'primeira linha', []),
    );
  });
});

function attachmentInfo(overrides: Partial<AttachmentInfo> = {}): AttachmentInfo {
  return {
    id: 'att-pdf',
    name: 'relatorio.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    kind: 'pdf',
    ...overrides,
  };
}

describe('AgentChannelView — anexos', () => {
  it('colar arquivos com Ctrl+V importa e mostra o chip', async () => {
    mocks.importClipboardAttachments.mockResolvedValue([attachmentInfo()]);
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');

    fireEvent.paste(composer, { clipboardData: { types: ['Files'], files: [] } });

    await waitFor(() => expect(mocks.importClipboardAttachments).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('relatorio.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 2 KB')).toBeTruthy();
  });

  it('não intercepta a colagem de texto', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    const composer = await screen.findByLabelText('Mensagem para o canal Lançamento');

    fireEvent.paste(composer, {
      clipboardData: { types: ['text/plain'], files: [], getData: () => 'texto' },
    });

    expect(mocks.importClipboardAttachments).not.toHaveBeenCalled();
  });

  it('anexa pelo botão + e publica somente com anexo', async () => {
    dialog.open.mockResolvedValue('C:\\docs\\relatorio.pdf');
    mocks.importAttachments.mockResolvedValue([attachmentInfo()]);
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    await screen.findByLabelText('Mensagem para o canal Lançamento');

    fireEvent.click(screen.getByRole('button', { name: 'Anexar arquivos' }));
    await waitFor(() =>
      expect(mocks.importAttachments).toHaveBeenCalledWith(['C:\\docs\\relatorio.pdf']),
    );
    await screen.findByText('relatorio.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar no canal' }));

    await waitFor(() =>
      expect(mocks.postAgentChannelMessage).toHaveBeenCalledWith('channel-1', '', ['att-pdf']),
    );
  });

  it('mostra os anexos das mensagens do histórico', async () => {
    mocks.listAgentChannelMessages.mockResolvedValue([
      {
        id: 'm-1',
        channelId: 'channel-1',
        role: 'user',
        agentId: null,
        content: 'olha o anexo',
        attachments: [attachmentInfo()],
        createdAt: 1,
      },
    ]);

    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);

    expect(await screen.findByText('olha o anexo')).toBeTruthy();
    expect(screen.getByText('relatorio.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 2 KB')).toBeTruthy();
  });

  it('drag & drop roteado para o canal importa os arquivos', async () => {
    render(<AgentChannelView channelId="channel-1" onBack={() => {}} onEdit={() => {}} />);
    await screen.findByLabelText('Mensagem para o canal Lançamento');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('lumina:channel-drop', { detail: { paths: ['C:\\a.pdf'] } }),
      );
    });

    await waitFor(() =>
      expect(mocks.importAttachments).toHaveBeenCalledWith(['C:\\a.pdf']),
    );
  });
});
