import type { AgentCapabilities } from './types';

/**
 * Factory defaults for every new persona, whether created by the user or by
 * another agent. Mirrors `AgentCapabilities::default()` in Rust.
 */
export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  webSearch: true,
  fileAccess: true,
  codeExecution: true,
  delegation: true,
  automation: true,
  sharedMemory: true,
  skillsWrite: true,
  createAgents: true,
  computerUse: true,
  screenCapture: true,
  browserUse: true,
  dockerExecution: true,
  skills: null,
  tools: null,
  mcpServers: null,
};
