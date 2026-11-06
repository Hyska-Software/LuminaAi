import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';

import { AgentDialogBody } from './AgentDialogBody';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Spinner,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  ROUTINE_STATUS_META,
  routineScheduleLabel,
} from '@/lib/routineCalendar';
import type { AgentRoutine, AgentRoutineRun } from '@/lib/types';

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(run: AgentRoutineRun): string {
  if (run.endedAt === null) return 'em andamento';
  const seconds = Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} min ${rest}s` : `${minutes} min`;
}

/** Execution history of one routine (agent_routine_runs). */
export function AgentRoutineRunsDialog({
  open,
  onOpenChange,
  routine,
  onOpenThread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routine: AgentRoutine | null;
  onOpenThread: (conversationId: string, agentId: string) => void;
}) {
  const [runs, setRuns] = useState<AgentRoutineRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open || !routine) {
      setRuns([]);
      return;
    }
    let disposed = false;
    setLoading(true);
    setError(null);
    api
      .listAgentRoutineRuns(routine.id, 30)
      .then((next) => {
        if (!disposed) setRuns(next);
      })
      .catch((caught) => {
        if (!disposed) setError(String(caught));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [open, routine, reloadToken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle>
            Execuções de {routine?.title ?? 'rotina'}
          </DialogTitle>
          <DialogDescription>
            {routine
              ? `${routineScheduleLabel(routine)} · últimas 30 execuções na conversa principal.`
              : 'Histórico de execução da rotina.'}
          </DialogDescription>
        </DialogHeader>

        <AgentDialogBody className="space-y-2">
          {loading ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 py-8 text-[12px] text-foreground-muted"
            >
              <Spinner size="sm" label="Carregando execuções" />
              Carregando execuções…
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              <p>Não foi possível carregar as execuções.</p>
              <p className="mt-1 text-[11px] opacity-80">{error}</p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 px-0"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                <RefreshCw className="mr-1.5 size-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-[12px] text-foreground-muted">
              Nenhuma execução registrada.
            </p>
          ) : (
            runs.map((run) => {
              const meta = ROUTINE_STATUS_META[run.status] ?? null;
              return (
                <article
                  key={run.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-surface/40 px-3 py-2.5"
                >
                  {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-foreground">
                      {formatWhen(run.startedAt)}
                    </span>
                    <span className="block truncate text-[10px] text-foreground-subtle">
                      {formatDuration(run)}
                      {run.error ? ` · ${run.error}` : ''}
                    </span>
                  </span>
                  {run.conversationId ? (
                    <IconButton
                      label="Abrir conversa"
                      size="sm"
                      onClick={() => {
                        if (!routine) return;
                        onOpenThread(run.conversationId!, routine.agentId);
                        onOpenChange(false);
                      }}
                    >
                      <ArrowUpRight className="size-3.5" />
                    </IconButton>
                  ) : null}
                </article>
              );
            })
          )}
        </AgentDialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
