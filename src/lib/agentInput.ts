import type { Agent, AgentInput } from './types';

/**
 * Full editable payload of an agent, used to patch a single field without
 * dropping the rest of the persona configuration on `update_agent`.
 */
export function inputFromAgent(agent: Agent): AgentInput {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    avatar: agent.avatar,
    department: agent.department,
    providerId: agent.providerId,
    modelId: agent.modelId,
    fallbackProviderId: agent.fallbackProviderId ?? null,
    fallbackModelId: agent.fallbackModelId ?? null,
    reasoning: agent.reasoning,
    instructions: agent.instructions,
    starters: [...agent.starters],
    capabilities: agent.capabilities,
    memoryEnabled: agent.memoryEnabled,
    workspaceId: agent.workspaceId,
    permissionMode: agent.permissionMode,
    dockerImage: agent.dockerImage ?? null,
    computerEnvironment: agent.computerEnvironment ?? 'auto',
  };
}
