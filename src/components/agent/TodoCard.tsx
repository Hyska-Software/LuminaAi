import { CheckCircle2, Circle, ListTodo, LoaderCircle } from 'lucide-react';
import { ProgressBar } from '@/components/ui';
import type { TodoItem, TodoStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TodoCardProps {
  todos: TodoItem[];
  className?: string;
  /**
   * `true` (default) gives the list its own max-height/scroll so a long list
   * never pushes the transcript (F-09). `false` lets the host own the only
   * scroll surface (the composer popover), avoiding nested wheel traps.
   */
  scrollable?: boolean;
}

const STATUS_META: Record<TodoStatus, { label: string; Icon: typeof Circle; color: string }> = {
  pending: { label: 'Pendente', Icon: Circle, color: 'text-foreground-muted' },
  in_progress: { label: 'Em andamento', Icon: LoaderCircle, color: 'text-accent' },
  completed: { label: 'Concluída', Icon: CheckCircle2, color: 'text-success' },
};

/**
 * Lista compacta de tarefas do agente (WORKBENCH §5.2). O status nunca é
 * transmitido só por cor: cada item tem um rótulo textual para leitores de tela.
 * By default the list has a max-height and its own scroll (`tabIndex=0`) so 50
 * items never push the transcript (F-09); `scrollable={false}` disables that
 * when the host already provides the single scroll surface.
 */
export function TodoCard({ todos, className, scrollable = true }: TodoCardProps) {
  if (todos.length === 0) return null;

  const total = todos.length;
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const inProgress = todos.filter((todo) => todo.status === 'in_progress').length;
  const percent = Math.round((done / total) * 100);

  return (
    <section
      aria-label="Tarefas do agente"
      className={cn('flex flex-col gap-2 rounded-xl border border-border bg-surface p-3', className)}
    >
      <header className="flex flex-wrap items-center gap-2">
        <ListTodo aria-hidden className="size-4 shrink-0 text-foreground-muted" />
        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-foreground">Tarefas</h3>
        <span className="text-[11px] text-foreground-muted">
          {done} de {total} concluída{total === 1 ? '' : 's'}
          {inProgress > 0 ? ` · ${inProgress} em andamento` : ''}
        </span>
      </header>

      <ProgressBar
        value={percent}
        size="xs"
        tone="accent"
        label={`Progresso das tarefas: ${percent}%`}
      />

      <ul
        aria-label="Lista de tarefas"
        tabIndex={scrollable ? 0 : undefined}
        className={cn(
          'flex flex-col gap-1.5',
          scrollable &&
            'max-h-64 overflow-y-auto overscroll-contain pr-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        {todos.map((todo, index) => {
          const meta = STATUS_META[todo.status] ?? STATUS_META.pending;
          const Icon = meta.Icon;
          return (
            <li
              key={`${index}-${todo.content}`}
              className="flex min-w-0 items-start gap-2 text-[12px] leading-relaxed"
            >
              <Icon
                aria-hidden
                className={cn(
                  'mt-0.5 size-3.5 shrink-0',
                  meta.color,
                  todo.status === 'in_progress' && 'animate-spin motion-reduce:animate-none',
                )}
              />
              <span
                className={cn(
                  'min-w-0 break-words',
                  todo.status === 'completed'
                    ? 'text-foreground-muted line-through'
                    : 'text-foreground-muted',
                )}
              >
                {todo.content}
              </span>
              <span className="sr-only"> — {meta.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
