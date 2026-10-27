import { CheckCircle2, Circle, ListTodo, LoaderCircle } from 'lucide-react';
import { ProgressBar } from '@/components/ui';
import type { TodoItem, TodoStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TodoCardProps {
  todos: TodoItem[];
  className?: string;
}

const STATUS_META: Record<TodoStatus, { label: string; Icon: typeof Circle; color: string }> = {
  pending: { label: 'Pendente', Icon: Circle, color: 'text-foreground-subtle' },
  in_progress: { label: 'Em andamento', Icon: LoaderCircle, color: 'text-accent' },
  completed: { label: 'Concluída', Icon: CheckCircle2, color: 'text-success' },
};

/**
 * Lista compacta de tarefas do agente (WORKBENCH §5.2). O status nunca é
 * transmitido só por cor: cada item tem um rótulo textual para leitores de tela.
 */
export function TodoCard({ todos, className }: TodoCardProps) {
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
        <ListTodo aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-foreground">Tarefas</h3>
        <span className="text-[11px] text-foreground-muted">
          {done} de {total} concluída{total === 1 ? '' : 's'}
          {inProgress > 0 ? ` · ${inProgress} em andamento` : ''}
        </span>
      </header>

      <ProgressBar value={percent} size="xs" tone="accent" label={`Progresso das tarefas: ${percent}%`} />

      <ul aria-label="Lista de tarefas" className="flex flex-col gap-1.5">
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
                    ? 'text-foreground-subtle line-through'
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
