// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentChannels: vi.fn(),
  listAgentChannelMessages: vi.fn(),
  postAgentChannelMessage: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { useAgentStore, useUiStore } from '@/lib/store';
import type { Agent, AgentChannel } from '@/lib/types';
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
  mocks.postAgentChannelMessage.mockResolvedValue({ messages: [], errors: [] });
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
      expect(mocks.postAgentChannelMessage).toHaveBeenCalledWith('channel-1', 'primeira linha'),
    );
  });
});
