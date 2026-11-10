import { useTranslation } from 'react-i18next';
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
import { AUTONOMOUS_MODE_WARNING_KEY, AUTONOMOUS_MODE_WARNING_TITLE_KEY } from '@/lib/permissionModes';
import { useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { PermissionMode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { GoalControls } from './GoalControls';

/** Translation keys of the session permission labels (WORKBENCH §4/§6). */
const PERMISSION_LABEL_KEYS: Record<PermissionMode, string> = {
  read_only: 'permissions.readOnly.label',
  review: 'permissions.review.label',
  edit: 'permissions.edit.label',
  autonomous: 'permissions.autonomous.label',
};

/** Translation keys of the permission descriptions (same as the old header chip). */
const PERMISSION_DESCRIPTION_KEYS: Record<PermissionMode, string> = {
  read_only: 'permissions.readOnly.description',
  review: 'permissions.review.description',
  edit: 'permissions.edit.description',
  autonomous: 'permissions.autonomous.description',
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

const PLAN_TITLE_ON_KEY = 'session.planTitleOn';
const PLAN_TITLE_OFF_KEY = 'session.planTitleOff';

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
 * popover "Plano e tarefas" (trigger somente ícone + indicadores; estado do
 * plano + progresso dos todos + jobs em segundo plano).
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
  const { t } = useTranslation('code');
  const { t: tc } = useTranslation('composer');
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
  const permissionLabel = tc(PERMISSION_LABEL_KEYS[permissionMode]);
  const permissionDescription = tc(PERMISSION_DESCRIPTION_KEYS[permissionMode]);
  const planTitle = tc(planMode ? PLAN_TITLE_ON_KEY : PLAN_TITLE_OFF_KEY);
  const planStateLabel =
    plan?.state === 'planning'
      ? tc('session.planState.planning')
      : plan?.state === 'reviewing'
        ? tc('session.planState.reviewing')
        : plan?.state === 'approved'
          ? tc('session.planState.approved')
          : null;

  const changePermissionMode = async (mode: PermissionMode) => {
    if (permissionBusy || mode === permissionMode) return;
    setPermissionBusy(true);
    try {
      const changed = await setPermissionMode(conversationId, mode);
      if (changed && mode === 'autonomous') {
        toast.warning(t(AUTONOMOUS_MODE_WARNING_TITLE_KEY), {
          description: t(AUTONOMOUS_MODE_WARNING_KEY),
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
            aria-label={tc('session.permissionAria', { mode: permissionLabel })}
            title={permissionDescription}
            disabled={permissionBusy}
            className={cn(
              PILL_CLASS_NAME,
              'bg-transparent',
              // Narrow composer: icon-only chip, like the Plano/goal toggles.
              '@max-[42rem]:w-8 @max-[42rem]:justify-center @max-[42rem]:px-0',
            )}
          >
            <PermissionIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate @max-[42rem]:hidden">{permissionLabel}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>{tc('session.permissionMenu')}</DropdownMenuLabel>
          {PERMISSION_ORDER.map((mode) => {
            const ModeIcon = PERMISSION_ICONS[mode];
            return (
              <DropdownMenuItem
                key={mode}
                icon={<ModeIcon className="size-4" />}
                checked={mode === permissionMode}
                onSelect={() => void changePermissionMode(mode)}
              >
                {tc(PERMISSION_LABEL_KEYS[mode])}
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
            {permissionDescription}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip content={planTitle} side="top">
        <button
          type="button"
          aria-label={tc('session.planAria', {
            state: tc(planMode ? 'session.planStateOn' : 'session.planStateOff'),
          })}
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

      {/* Trigger somente ícone + indicadores (sem rótulo visível);
          o nome acessível/tooltip carregam o texto completo. */}
      <Popover open={planOpen} onOpenChange={setPlanOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={tc('session.planTitle')}
            title={tc('session.planTitle')}
            className={cn(PILL_CLASS_NAME, 'justify-center bg-transparent px-2')}
          >
            <ListTodo aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            {todos.length > 0 ? (
              <span className="text-[11px] tabular-nums text-foreground-muted">
                {todos.filter((todo) => todo.status === 'completed').length}/{todos.length}
              </span>
            ) : null}
            {jobs.length > 0 ? (
              <span
                className="flex items-center gap-0.5 text-[11px] tabular-nums text-foreground-muted"
                title={tc('session.jobsTitle', {
                  running: jobs.filter((job) => job.status === 'running').length,
                  total: jobs.length,
                })}
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
                {tc('session.planWithState', { state: planStateLabel })}
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
                    title: tc('plan.title'),
                    updatedAt: view.updatedAt,
                  });
                }}
              />
            ) : (
              <p className="px-1 text-[12px] leading-relaxed text-foreground-muted">
                {tc('session.noPlan')}
              </p>
            )}
            {todos.length > 0 ? (
              <TodoCard todos={todos} scrollable={false} />
            ) : (
              <p className="px-1 text-[12px] leading-relaxed text-foreground-muted">
                {tc('session.noTasks')}
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
                  {tc('session.noJobs')}
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
