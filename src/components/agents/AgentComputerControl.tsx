import { useState } from 'react';
import { MonitorStop, Square } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui';
import { useActiveComputerSessions } from '@/components/computer/useActiveComputerSessions';
import { api } from '@/lib/api';

/**
 * Compact computer-use status for the agent thread topbar.
 *
 * The global floating banner remains the fail-safe outside this header (and
 * for sessions in other threads); here the current conversation owns the
 * status and the stop action, next to the agent/model controls.
 */
export function AgentComputerControl({ conversationId }: { conversationId: string }) {
  const { sessions, clear } = useActiveComputerSessions();
  const [busy, setBusy] = useState(false);
  const session = sessions.find((entry) => entry.conversationId === conversationId);
  if (!session) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await api.stopComputerSession(conversationId);
      clear();
      toast.success('Computer use interrompido');
    } catch (error) {
      toast.error('Não foi possível parar', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Computer use ativo"
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft py-1 pl-2 pr-1 text-warning"
      title={`Lumina está controlando o computador · ${session.backend}`}
    >
      <MonitorStop className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden max-w-56 truncate text-[11px] font-medium xl:inline">
        Lumina está controlando o computador
      </span>
      <span className="text-[11px] font-medium xl:hidden">Controlando</span>
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={() => void stop()}
        aria-label="Parar computer use"
      >
        <Square className="mr-1 size-3" />
        Parar
      </Button>
    </div>
  );
}
