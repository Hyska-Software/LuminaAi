import { create } from 'zustand';

import { api } from '@/lib/api';
import type { Agent, AgentAvatar, AgentInput } from '@/lib/types';

let initializePromise: Promise<void> | null = null;
const avatarSequence = new Map<string, number>();

function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const department = left.department.localeCompare(right.department, 'pt-BR', {
      sensitivity: 'base',
    });
    if (department !== 0) return department;
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
  });
}

interface AgentState {
  agentsById: Record<string, Agent>;
  orderedIds: string[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  mutationById: Record<string, 'saving' | 'archiving' | 'restoring' | 'deleting'>;
  initialized: boolean;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (input: AgentInput) => Promise<Agent>;
  update: (id: string, input: AgentInput) => Promise<Agent>;
  updateAvatar: (id: string, avatar: AgentAvatar) => Promise<void>;
  pin: (id: string, pinned: boolean) => Promise<void>;
  archive: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function indexAgents(agents: Agent[]): Pick<AgentState, 'agentsById' | 'orderedIds'> {
  return {
    agentsById: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    orderedIds: sortAgents(agents).map((agent) => agent.id),
  };
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agentsById: {},
  orderedIds: [],
  status: 'idle',
  error: null,
  mutationById: {},
  initialized: false,

  initialize: () => {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      set({ status: 'loading', error: null });
      try {
        const agents = await api.listAgents(true);
        set({ ...indexAgents(agents), status: 'ready', initialized: true, error: null });
      } catch (error) {
        set({ status: 'error', initialized: true, error: String(error) });
      }
    })();
    return initializePromise;
  },

  refresh: async () => {
    try {
      const agents = await api.listAgents(true);
      set({ ...indexAgents(agents), status: 'ready', error: null });
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },

  create: async (input) => {
    const agent = await api.createAgent(input);
    set((state) => {
      const next = { ...state.agentsById, [agent.id]: agent };
      const ordered = sortAgents(Object.values(next)).map((item) => item.id);
      return { agentsById: next, orderedIds: ordered, status: 'ready', error: null };
    });
    return agent;
  },

  update: async (id, input) => {
    set((state) => ({ mutationById: { ...state.mutationById, [id]: 'saving' } }));
    try {
      const agent = await api.updateAgent(id, input);
      set((state) => {
        const next = { ...state.agentsById, [id]: agent };
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return {
          agentsById: next,
          orderedIds: sortAgents(Object.values(next)).map((item) => item.id),
          mutationById,
        };
      });
      return agent;
    } catch (error) {
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { mutationById };
      });
      throw error;
    }
  },

  updateAvatar: async (id, avatar) => {
    const current = get().agentsById[id];
    if (!current) return;
    const previous = current.avatar;
    const sequence = (avatarSequence.get(id) ?? 0) + 1;
    avatarSequence.set(id, sequence);
    set((state) => ({
      agentsById: { ...state.agentsById, [id]: { ...state.agentsById[id], avatar } },
    }));
    try {
      const agent = await api.setAgentAvatar(id, avatar);
      if (avatarSequence.get(id) !== sequence) return;
      set((state) => ({ agentsById: { ...state.agentsById, [id]: agent } }));
    } catch (error) {
      if (avatarSequence.get(id) === sequence) {
        set((state) => ({
          agentsById: {
            ...state.agentsById,
            [id]: { ...state.agentsById[id], avatar: previous },
          },
        }));
      }
      throw error;
    }
  },

  pin: async (id, pinned) => {
    set((state) => ({ mutationById: { ...state.mutationById, [id]: 'saving' } }));
    try {
      const agent = await api.setAgentPinned(id, pinned);
      set((state) => {
        const next = { ...state.agentsById, [id]: agent };
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return {
          agentsById: next,
          orderedIds: sortAgents(Object.values(next)).map((item) => item.id),
          mutationById,
        };
      });
    } catch (error) {
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { mutationById };
      });
      throw error;
    }
  },

  archive: async (id) => {
    set((state) => ({ mutationById: { ...state.mutationById, [id]: 'archiving' } }));
    try {
      const agent = await api.archiveAgent(id);
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { agentsById: { ...state.agentsById, [id]: agent }, mutationById };
      });
    } catch (error) {
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { mutationById };
      });
      throw error;
    }
  },

  restore: async (id) => {
    set((state) => ({ mutationById: { ...state.mutationById, [id]: 'restoring' } }));
    try {
      const agent = await api.restoreAgent(id);
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { agentsById: { ...state.agentsById, [id]: agent }, mutationById };
      });
    } catch (error) {
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { mutationById };
      });
      throw error;
    }
  },

  remove: async (id) => {
    set((state) => ({ mutationById: { ...state.mutationById, [id]: 'deleting' } }));
    try {
      await api.deleteAgent(id);
      set((state) => {
        const agentsById = { ...state.agentsById };
        delete agentsById[id];
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return {
          agentsById,
          orderedIds: state.orderedIds.filter((agentId) => agentId !== id),
          mutationById,
        };
      });
    } catch (error) {
      set((state) => {
        const mutationById = { ...state.mutationById };
        delete mutationById[id];
        return { mutationById };
      });
      throw error;
    }
  },
}));

export function selectAgent(state: AgentState, id: string | null): Agent | null {
  return id ? (state.agentsById[id] ?? null) : null;
}

export function selectActiveAgents(state: AgentState): Agent[] {
  return state.orderedIds
    .map((id) => state.agentsById[id])
    .filter((agent): agent is Agent => Boolean(agent) && agent.archivedAt === null);
}

export function selectPinnedAgents(state: AgentState): Agent[] {
  return selectActiveAgents(state).filter((agent) => agent.pinned);
}

export function selectArchivedAgents(state: AgentState): Agent[] {
  return state.orderedIds
    .map((id) => state.agentsById[id])
    .filter((agent): agent is Agent => Boolean(agent) && agent.archivedAt !== null);
}

export function selectAgentsByDepartment(state: AgentState): Array<{
  department: string;
  agents: Agent[];
}> {
  const groups = new Map<string, Agent[]>();
  for (const agent of selectActiveAgents(state)) {
    const list = groups.get(agent.department) ?? [];
    list.push(agent);
    groups.set(agent.department, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' }))
    .map(([department, agents]) => ({ department, agents }));
}
