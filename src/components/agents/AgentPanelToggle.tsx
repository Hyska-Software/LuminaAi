import { PanelRight } from 'lucide-react';

import { IconButton, Tooltip } from '@/components/ui';
import { useUiStore } from '@/lib/store';

/**
 * Opens/closes the agent right panel. Shared by every agent surface so the
 * panel always has the same control and state semantics wherever it matters.
 */
export function AgentPanelButton({ className }: { className?: string }) {
  const open = useUiStore((state) => state.agentPanelOpen);
  const rightPanel = useUiStore((state) => state.agentRightPanel);
  const setOpen = useUiStore((state) => state.setAgentPanelOpen);
  const setRightPanel = useUiStore((state) => state.setAgentRightPanel);
  const active = open && rightPanel === 'agent';
  const label = active ? 'Recolher painel do agente' : 'Abrir painel do agente';

  return (
    <Tooltip content={label} side="bottom">
      <IconButton
        label={label}
        size="sm"
        variant="ghost"
        active={active}
        className={className}
        onClick={() => {
          setRightPanel('agent');
          setOpen(!active);
        }}
      >
        <PanelRight className="size-4" />
      </IconButton>
    </Tooltip>
  );
}

/**
 * Floating reopen control for agent surfaces that have no header of their own
 * (home and archived persona). It is only rendered while the panel is closed,
 * so closing the right sidebar never strands the user without a way back —
 * including when the left sidebar is hidden too.
 */
export function AgentPanelOpener() {
  const open = useUiStore((state) => state.agentPanelOpen);
  if (open) return null;

  return (
    <div className="absolute right-3 top-3 z-20">
      <AgentPanelButton />
    </div>
  );
}
