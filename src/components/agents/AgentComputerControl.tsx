import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('agents');
  const { sessions, clear } = useActiveComputerSessions();
  const [busy, setBusy] = useState(false);
  const session = sessions.find((entry) => entry.conversationId === conversationId);
  if (!session) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await api.stopComputerSession(conversationId);
      clear();
      toast.success(t('computerControl.stopped'));
    } catch (error) {
      toast.error(t('computerControl.stopError'), { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label={t('computerControl.aria')}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-warning-soft py-1 pl-2 pr-1 text-warning"
      title={t('computerControl.title', { backend: session.backend })}
    >
      <MonitorStop className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden max-w-56 truncate text-[11px] font-medium xl:inline">
        {t('computerControl.active')}
      </span>
      <span className="text-[11px] font-medium xl:hidden">{t('computerControl.activeShort')}</span>
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={() => void stop()}
        aria-label={t('computerControl.stopAria')}
      >
        <Square className="mr-1 size-3" />
        {t('computerControl.stop')}
      </Button>
    </div>
  );
}
