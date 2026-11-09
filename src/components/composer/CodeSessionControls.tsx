import { useState } from 'react';
import {
  FileSearch,
  ListChecks,
  ListTodo,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@/components/ui';
import { JobsBar, PlanCard, SubagentList, TodoCard } from '@/components/agent';
import { AUTONOMOUS_MODE_WARNING, AUTONOMOUS_MODE_WARNING_TITLE } from '@/lib/permissionModes';
import { useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { PermissionMode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { GoalControls } from './GoalControls';

/** Rótulos pt-BR do modo de permissão da sessão (WORKBENCH §4/§6). */
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  read_only: 'Leitura',
  review: 'Revisar',
  edit: 'Editar',
  autonomous: 'Autônomo',
};

/** Descrições idênticas às do antigo chip do cabeçalho do Code. */
const PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
  read_only: 'O agente só pode ler arquivos e consultar o workspace.',
  review: 'O agente pode propor edições, mas cada escrita pede aprovação.',
  edit: 'O agente pode editar arquivos; comandos pedem aprovação.',
  autonomous:
    'O agente executa comandos, edições, acesso a segredos e controle do computador sem pedir confirmação.',
};

const PERMISSION_ICONS: Record<PermissionMode, LucideIcon> = {
  read_only: Shield,
  review: FileSearch,
  edit: ShieldCheck,
  autonomous: ShieldAlert,
};

/** Ordem do menu: da permissão mais restrita para a mais ampla. */
const PERMISSION_ORDER: PermissionMode[] = ['read_only', 'review', 'edit', 'autonomous'];

/** Estilo base dos pills de sessão (tokens do design system). */
const PILL_CLASS_NAME =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12.5px] font-medium text-foreground-muted transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-60';

/**
 * Toggle do modo Plano **somente ícone** (pedido de produto): mesma geometria
 * do botão do objetivo do `GoalControls` (size-8 circular), estado comunicado
 * por cor + `aria-pressed`/`aria-label`/tooltip.
 */
const PLAN_ICON_BUTTON_CLASS_NAME =
  'flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-60';

const PLAN_TITLE_ON = 'Modo Plano ativo: o agente planeja antes de editar';
const PLAN_TITLE_OFF = 'Ativar modo Plano (planejar antes de editar)';

export interface CodeSessionControlsProps {
  conversationId: string;
  className?: string;
  /**
   * Intenção `/goal` do turno (badge no campo): o botão do objetivo reflete o
   * estado ativo como o toggle do modo Plano (paridade de ativação).
   */
  goalIntent?: boolean;
  /** Alterna a intenção `/goal`; ausente ⇒ fallback do `GoalControls`. */
  onToggleGoalIntent?: () => void;
}

/**
 * Controles de sessão do composer no layout Code (WORKBENCH §6): chip do modo
 * de permissão (Leitura/Revisar/Editar/Autônomo), toggle do modo Plano e o
 * popover "Plano e tarefas" (estado do plano + progresso dos todos).
 *
 * O snapshot da sessão vem do `codeStore` (o `chatStore` o carrega ao abrir a
 * conversa); a linha da conversa é o fallback enquanto ele não chegou.
 */
export function CodeSessionControls({
  conversationId,
  className,
  goalIntent,
  onToggleGoalIntent,
}: CodeSessionControlsProps) {
  const session = useCodeStore((state) => state.byConversation[conversationId]);
  const fallbackPermissionMode = useChatStore(
    (state) =>
      state.conversations.find((conversation) => conversation.id === conversationId)?.permissionMode,
  );
  const setPermissionMode = useCodeStore((state) => state.setPermissionMode);
  const setPlanMode = useCodeStore((state) => state.setPlanMode);
  const killJob = useCodeStore((state) => state.killJob);
  const refreshJobs = useCodeStore((state) => state.refreshJobs);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  // O modo real vem da sessão (snapshot) ou da linha da conversa; o fallback
  // final é o padrão de fábrica do Code (Autônomo) enquanto nada carregou.
  const permissionMode = session?.permissionMode ?? fallbackPermissionMode ?? 'autonomous';
  const planMode = session?.planMode ?? false;
  const plan = session?.plan ?? null;
  const todos = session?.todos ?? [];
  const jobs = session?.jobs ?? [];
  const PermissionIcon = PERMISSION_ICONS[permissionMode];
  const planTitle = planMode ? PLAN_TITLE_ON : PLAN_TITLE_OFF;
  const planStateLabel =
    plan?.state === 'planning'
      ? 'Em preparação'
      : plan?.state === 'reviewing'
        ? 'Aguardando aprovação'
        : plan?.state === 'approved'
          ? 'Aprovado'
          : null;

  const changePermissionMode = async (mode: PermissionMode) => {
    if (permissionBusy || mode === permissionMode) return;
    setPermissionBusy(true);
    try {
      const changed = await setPermissionMode(conversationId, mode);
      if (changed && mode === 'autonomous') {
        toast.warning(AUTONOMOUS_MODE_WARNING_TITLE, {
          description: AUTONOMOUS_MODE_WARNING,
        });
      }
    } finally {
      setPermissionBusy(false);
    }
  };

  const togglePlanMode = async () => {
    if (planBusy) return;
    setPlanBusy(true);
    try {
      await setPlanMode(conversationId, !planMode);
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-haspopup="menu"
            aria-label={`Modo de permissão: ${PERMISSION_LABELS[permissionMode]}`}
            title={PERMISSION_DESCRIPTIONS[permissionMode]}
            disabled={permissionBusy}
            className={cn(PILL_CLASS_NAME, 'bg-transparent')}
          >
            <PermissionIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{PERMISSION_LABELS[permissionMode]}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Modo de permissão</DropdownMenuLabel>
          {PERMISSION_ORDER.map((mode) => {
            const ModeIcon = PERMISSION_ICONS[mode];
            return (
              <DropdownMenuItem
                key={mode}
                icon={<ModeIcon className="size-4" />}
                checked={mode === permissionMode}
                onSelect={() => void changePermissionMode(mode)}
              >
                {PERMISSION_LABELS[mode]}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <p
            className={cn(
              'px-2 pb-1 text-[11px] leading-relaxed',
              permissionMode === 'autonomous' ? 'text-warning' : 'text-foreground-muted',
            )}
          >
            {PERMISSION_DESCRIPTIONS[permissionMode]}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip content={planTitle} side="top">
        <button
          type="button"
          aria-label={`Modo Plano: ${planMode ? 'ativado' : 'desativado'}`}
          aria-pressed={planMode}
          disabled={planBusy}
          onClick={() => void togglePlanMode()}
          className={cn(
            PLAN_ICON_BUTTON_CLASS_NAME,
            planMode
              ? 'border-accent/40 bg-accent-soft'
              : 'border-border bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
          )}
        >
          <ListChecks
            aria-hidden
            className={cn('size-3.5 shrink-0', planMode ? 'text-accent' : undefined)}
            strokeWidth={1.75}
          />
        </button>
      </Tooltip>

      {/* Objetivo da sessão entre o modo Plano e o popover "Plano e tarefas"
          (docs/goals/code-goals/PLAN.md §10.7). */}
      <GoalControls
        conversationId={conversationId}
        goalIntent={goalIntent}
        onToggleGoalIntent={onToggleGoalIntent}
      />

      <Popover open={planOpen} onOpenChange={setPlanOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Plano, tarefas e trabalhos em segundo plano"
            className={cn(PILL_CLASS_NAME, 'bg-transparent')}
          >
            <ListTodo aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">Plano e tarefas</span>
            {todos.length > 0 ? (
              <span className="text-[11px] tabular-nums text-foreground-muted">
                {todos.filter((todo) => todo.status === 'completed').length}/{todos.length}
              </span>
            ) : null}
            {jobs.length > 0 ? (
              <span
                className="flex items-center gap-0.5 text-[11px] tabular-nums text-foreground-muted"
                title={`${jobs.filter((job) => job.status === 'running').length} rodando · ${jobs.length} no total`}
              >
                <SquareTerminal aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
                {jobs.length}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto overscroll-contain p-2">
            {planStateLabel ? (
              <p className="px-1 text-[11px] font-medium text-foreground-muted">
                Plano · {planStateLabel}
              </p>
            ) : null}
            {plan ? (
              <PlanCard
                plan={plan}
                readOnly
                scrollable={false}
                onViewPlan={(view) => {
                  const markdown = view.markdown?.trim();
                  if (!markdown) return;
                  setPlanOpen(false);
                  // Aba central de plano (mesma faixa/prévia dos arquivos da
                  // filetree): Markdown com alternância Documento ⇄ Código.
                  useUiStore.getState().openCodePlan({
                    conversationId,
                    markdown,
                    title: 'Plano',
                    updatedAt: view.updatedAt,
                  });
                }}
              />
            ) : (
              <p className="px-1 text-[12px] leading-relaxed text-foreground-muted">
                Nenhum plano nesta sessão.
              </p>
            )}
            {todos.length > 0 ? (
              <TodoCard todos={todos} scrollable={false} />
            ) : (
              <p className="px-1 text-[12px] leading-relaxed text-foreground-muted">
                Nenhuma tarefa registrada.
              </p>
            )}
            <div className="border-t border-border pt-2">
              {jobs.length > 0 ? (
                <JobsBar
                  jobs={jobs}
                  onKill={(jobId) => {
                    void killJob(conversationId, jobId);
                  }}
                  onOpen={() => {
                    void refreshJobs(conversationId);
                  }}
                />
              ) : (
                <p className="px-1 text-[12px] leading-relaxed text-foreground-muted">
                  Nenhum trabalho em segundo plano.
                </p>
              )}
            </div>
            <div className="border-t border-border pt-2">
              <SubagentList conversationId={conversationId} />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
