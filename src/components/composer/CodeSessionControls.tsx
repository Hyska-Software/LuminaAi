import { useState } from 'react';
import { ListChecks, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';
import { useChatStore, useCodeStore } from '@/lib/store';
import type { PermissionMode } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Rótulos pt-BR do modo de permissão da sessão (WORKBENCH §4/§6). */
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  read_only: 'Leitura',
  edit: 'Editar',
  autonomous: 'Autônomo',
};

/** Descrições idênticas às do antigo chip do cabeçalho do Code. */
const PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
  read_only: 'O agente só pode ler arquivos e consultar o workspace.',
  edit: 'O agente pode editar arquivos; comandos pedem aprovação.',
  autonomous: 'O agente pode editar e executar comandos com menos confirmações.',
};

const PERMISSION_ICONS: Record<PermissionMode, LucideIcon> = {
  read_only: Shield,
  edit: ShieldCheck,
  autonomous: ShieldAlert,
};

const PERMISSION_ORDER: PermissionMode[] = ['read_only', 'edit', 'autonomous'];

/** Estilo base dos dois pills de sessão (tokens do design system). */
const PILL_CLASS_NAME =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12.5px] font-medium text-foreground-muted transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-60';

const PLAN_TITLE_ON = 'Modo Plano ativo: o agente planeja antes de editar';
const PLAN_TITLE_OFF = 'Ativar modo Plano (planejar antes de editar)';

export interface CodeSessionControlsProps {
  conversationId: string;
  className?: string;
}

/**
 * Controles de sessão do composer no layout Code (WORKBENCH §6): chip do modo
 * de permissão (Leitura/Editar/Autônomo) e toggle do modo Plano. Substituem os
 * pills globais "Busca web"/"Criar arquivos", que continuam apenas no Chat.
 *
 * O snapshot da sessão vem do `codeStore` (o `chatStore` o carrega ao abrir a
 * conversa); a linha da conversa é o fallback enquanto ele não chegou. A troca
 * de permissão é otimista no store, que também faz o rollback e o toast de
 * erro — aqui só vive o estado local de "ocupado" que desabilita os pills.
 */
export function CodeSessionControls({ conversationId, className }: CodeSessionControlsProps) {
  const session = useCodeStore((state) => state.byConversation[conversationId]);
  const fallbackPermissionMode = useChatStore(
    (state) =>
      state.conversations.find((conversation) => conversation.id === conversationId)?.permissionMode,
  );
  const setPermissionMode = useCodeStore((state) => state.setPermissionMode);
  const setPlanMode = useCodeStore((state) => state.setPlanMode);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);

  const permissionMode = session?.permissionMode ?? fallbackPermissionMode ?? 'edit';
  const planMode = session?.planMode ?? false;
  const PermissionIcon = PERMISSION_ICONS[permissionMode];
  const planTitle = planMode ? PLAN_TITLE_ON : PLAN_TITLE_OFF;

  const changePermissionMode = async (mode: PermissionMode) => {
    if (permissionBusy || mode === permissionMode) return;
    setPermissionBusy(true);
    try {
      await setPermissionMode(conversationId, mode);
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
        <DropdownMenuContent align="start" className="min-w-60">
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
          <p className="px-2 pb-1 text-[11px] leading-relaxed text-foreground-subtle">
            {PERMISSION_DESCRIPTIONS[permissionMode]}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip content={planTitle} side="top">
        <button
          type="button"
          aria-label="Modo Plano"
          aria-pressed={planMode}
          title={planTitle}
          disabled={planBusy}
          onClick={() => void togglePlanMode()}
          className={cn(
            PILL_CLASS_NAME,
            planMode
              ? 'border-accent/40 bg-accent-soft text-accent hover:bg-accent-soft'
              : 'bg-transparent',
          )}
        >
          <ListChecks aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Plano</span>
        </button>
      </Tooltip>
    </div>
  );
}
