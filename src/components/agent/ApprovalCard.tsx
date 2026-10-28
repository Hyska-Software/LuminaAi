import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  FilePenLine,
  Flame,
  FolderLock,
  Globe,
  KeyRound,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Textarea,
  type BadgeVariant,
} from '@/components/ui';
import type {
  ApprovalDecision,
  ApprovalOption,
  ApprovalRequest,
  ApprovalScope,
  RiskClass,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/** Opções extras devolvidas junto da decisão (espelha `api.respondApproval`). */
export interface ApprovalDecisionOptions {
  /** Escopo escolhido em "Sempre permitir". */
  scope?: ApprovalScope | null;
  /** Motivo da negação (volta para o agente). */
  feedback?: string | null;
  /** Id da opção do pedido escolhida (quando o backend manda `options`). */
  optionId?: string;
}

/** Resolução já conhecida pelo host (replay, decisão otimista ou timeout). */
export interface ApprovalResolution {
  decision: ApprovalDecision;
  scope?: ApprovalScope | null;
  feedback?: string | null;
}

export interface ApprovalCardProps {
  approval: ApprovalRequest;
  onDecide: (decision: ApprovalDecision, options?: ApprovalDecisionOptions) => void;
  /** Quando o host já resolveu o pedido, renderiza a linha compacta. */
  resolution?: ApprovalResolution | null;
  /** Desabilita as ações enquanto o host aguarda o backend. */
  responding?: boolean;
  /** Escopo de uma regra já salva para esta tool (mostrado no menu), se houver. */
  savedScope?: ApprovalScope | null;
  className?: string;
}

interface RiskMeta {
  label: string;
  tone: BadgeVariant;
  Icon: LucideIcon;
  /** Título humano do card quando o backend manda um título vazio. */
  ask: string;
}

/** Rótulos e cores (sempre acompanhados de texto — nunca só cor) por classe de risco. */
const RISK: Record<RiskClass, RiskMeta> = {
  read: { label: 'Leitura', tone: 'neutral', Icon: Eye, ask: 'Ler arquivo?' },
  write: { label: 'Escrita', tone: 'outline', Icon: FilePenLine, ask: 'Gravar alteração?' },
  shell: { label: 'Comando', tone: 'warning', Icon: SquareTerminal, ask: 'Executar comando?' },
  outside: { label: 'Fora do projeto', tone: 'warning', Icon: FolderLock, ask: 'Ler arquivo fora do projeto?' },
  secret: { label: 'Segredo', tone: 'warning', Icon: KeyRound, ask: 'Ler arquivo de segredo?' },
  destroy: { label: 'Destrutivo', tone: 'danger', Icon: Flame, ask: 'Executar ação destrutiva?' },
  network: { label: 'Rede', tone: 'warning', Icon: Globe, ask: 'Acessar a rede?' },
  ask: { label: 'Confirmar', tone: 'accent', Icon: ShieldQuestion, ask: 'Confirmar ação?' },
};

const SCOPE_LABEL: Record<ApprovalScope, string> = {
  session: 'Nesta sessão',
  workspace: 'Neste workspace',
  global: 'Sempre',
};

const SCOPE_SHORT: Record<ApprovalScope, string> = {
  session: 'nesta sessão',
  workspace: 'neste workspace',
  global: 'sempre',
};

const SCOPE_ORDER: ApprovalScope[] = ['session', 'workspace', 'global'];

const MAX_LISTED_PATHS = 5;

function resolutionText(resolution: ApprovalResolution): string {
  switch (resolution.decision) {
    case 'approved':
      return resolution.scope
        ? `Permitido · ${SCOPE_SHORT[resolution.scope]}`
        : 'Permitido';
    case 'denied': {
      const reason = resolution.feedback?.trim();
      return reason ? `Negado: “${reason}”` : 'Negado';
    }
    case 'cancelled':
      return 'Cancelado';
    case 'expired':
      return 'Expirado';
    default:
      return 'Resolvido';
  }
}

/**
 * Aprovação inline da timeline (WORKBENCH §5.3): mostra o alvo exato (comando,
 * paths, segredo, path externo), a classe de risco e as três saídas — permitir,
 * negar (com motivo opcional) e "sempre permitir" em um escopo. Puramente
 * apresentacional: a decisão sobe via `onDecide`.
 */
export function ApprovalCard({
  approval,
  onDecide,
  resolution,
  responding = false,
  savedScope = null,
  className,
}: ApprovalCardProps) {
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const allowRef = useRef<HTMLButtonElement>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const [ownResolution, setOwnResolution] = useState<ApprovalResolution | null>(null);

  // A resolução do host manda; sem ela vale a decisão otimista local.
  useEffect(() => {
    if (resolution) setOwnResolution(resolution);
  }, [resolution]);

  const resolved = resolution ?? ownResolution;
  const busy = responding;

  // Foco inicial no primário (WORKBENCH §10). Roda no mount de cada pedido.
  useEffect(() => {
    if (!resolved) allowRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- foco só no mount/novo pedido
  }, [approval.id]);

  const risk = RISK[approval.risk] ?? RISK.ask;
  const RiskIcon = risk.Icon;

  const allowOption: ApprovalOption | null =
    approval.options.find((option) => !option.scope) ?? approval.options[0] ?? null;

  const scopeItems = SCOPE_ORDER.map((scope) => {
    const option = approval.options.find((candidate) => candidate.scope === scope);
    return { scope, option, label: option?.label ?? SCOPE_LABEL[scope] };
  });

  const decide = (decision: ApprovalDecision, options?: ApprovalDecisionOptions) => {
    if (busy || resolved) return;
    setOwnResolution({
      decision,
      scope: options?.scope ?? null,
      feedback: options?.feedback ?? null,
    });
    setDenying(false);
    onDecide(decision, options);
  };

  const deny = () => {
    const feedback = reason.trim();
    decide('denied', feedback ? { feedback } : undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || resolved || busy) return;
    event.preventDefault();
    event.stopPropagation();
    if (denying) {
      // Esc fecha o campo de motivo sem negar por acidente.
      setDenying(false);
      setReason('');
      return;
    }
    decide('denied');
  };

  const announcement = resolved
    ? `Aprovação ${resolutionText(resolved)}`
    : `Aprovação necessária: ${approval.title}. Risco: ${risk.label}.`;

  return (
    <div
      role={resolved ? undefined : 'alertdialog'}
      aria-labelledby={resolved ? undefined : titleId}
      aria-describedby={resolved ? undefined : descriptionId}
      aria-busy={busy || undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'rounded-xl border border-border bg-surface',
        resolved ? 'px-3 py-2' : 'p-3',
        !resolved && dangerRing(approval.risk),
        className,
      )}
    >
      <p aria-live="assertive" className="sr-only">
        {announcement}
      </p>

      {resolved ? (
        <ResolvedLine resolution={resolved} />
      ) : (
        <>
          <div className="flex min-w-0 items-start gap-2">
            <RiskIcon
              aria-hidden
              className={cn('mt-0.5 size-4 shrink-0', riskColor(approval.risk))}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id={titleId} className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">
                  {approval.title || risk.ask}
                </h3>
                <Badge variant={risk.tone}>{risk.label}</Badge>
                <span className="font-mono text-[11px] text-foreground-muted">{approval.tool}</span>
              </div>
              <div id={descriptionId} className="mt-2 flex flex-col gap-2">
                <ApprovalDetailView
                  title={approval.title || risk.ask}
                  detail={approval.detail}
                  preview={approval.preview}
                />
              </div>
            </div>
          </div>

          {denying ? (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor={reasonId} className="text-[11px] font-medium text-foreground-muted">
                Motivo da negação (opcional)
              </label>
              <Textarea
                id={reasonId}
                value={reason}
                rows={2}
                autoFocus
                placeholder="Ex.: use pnpm em vez de npm"
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setDenying(false); setReason(''); }}>
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={deny}
                  leftIcon={<X className="size-4" />}
                >
                  Negar
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                ref={allowRef}
                size="sm"
                variant="primary"
                disabled={busy}
                loading={busy}
                onClick={() => decide('approved', { optionId: allowOption?.id })}
                leftIcon={<Check className="size-4" />}
              >
                {allowOption?.label ?? 'Permitir'}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDenying(true)}>
                Negar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    rightIcon={<ChevronDown className="size-3.5" />}
                  >
                    Sempre permitir
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Lembrar para</DropdownMenuLabel>
                  {savedScope ? (
                    <p className="px-2 pb-1 text-[11px] leading-snug text-foreground-muted">
                      Regra salva: {SCOPE_SHORT[savedScope]}
                    </p>
                  ) : null}
                  {scopeItems.map(({ scope, option, label }) => (
                    <DropdownMenuItem
                      key={scope}
                      checked={savedScope === scope}
                      onSelect={() => decide('approved', { scope, optionId: option?.id })}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <p className="px-2 py-1 text-[11px] leading-snug text-foreground-muted">
                    A regra só vale para <span className="font-mono">{approval.tool}</span>.
                  </p>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResolvedLine({ resolution }: { resolution: ApprovalResolution }) {
  const approved = resolution.decision === 'approved';
  return (
    <div className="flex items-center gap-2 text-[12px] text-foreground-muted" role="status">
      {approved ? (
        <Check aria-hidden className="size-3.5 shrink-0 text-success" />
      ) : (
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      )}
      <span className="min-w-0 break-words">{resolutionText(resolution)}</span>
    </div>
  );
}

function riskColor(risk: RiskClass): string {
  switch (risk) {
    case 'destroy':
      return 'text-danger';
    case 'shell':
    case 'secret':
    case 'outside':
    case 'network':
      return 'text-warning';
    case 'read':
      return 'text-foreground-muted';
    default:
      return 'text-foreground-muted';
  }
}

function dangerRing(risk: RiskClass): string {
  return risk === 'destroy' ? 'border-danger/30' : '';
}

function ApprovalDetailView({
  detail,
  preview,
  title,
}: {
  detail: ApprovalRequest['detail'];
  preview?: string | null;
  title: string;
}): ReactNode {
  switch (detail.kind) {
    case 'command':
      return (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-foreground-muted">
            cwd: <span className="font-mono text-foreground-muted">{detail.workdir}</span>
          </p>
          <pre
            aria-label={`Comando a executar: ${title}`}
            tabIndex={0}
            className="max-h-40 overflow-auto rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground [overflow-wrap:anywhere]"
          >
            {detail.command}
          </pre>
        </div>
      );
    case 'paths': {
      const visible = detail.paths.slice(0, MAX_LISTED_PATHS);
      const hidden = detail.paths.length - visible.length;
      return (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-foreground-muted">
            {detail.change || 'Alterar arquivos'}
          </p>
          <ul aria-label="Arquivos que serão alterados" className="flex flex-col gap-0.5">
            {visible.map((path) => (
              <li key={path} className="truncate font-mono text-[12px] text-foreground-muted" title={path}>
                {path}
              </li>
            ))}
            {hidden > 0 ? (
              <li className="text-[11px] text-foreground-muted">+{hidden} outro(s) arquivo(s)</li>
            ) : null}
          </ul>
          {preview ? (
            <pre
              aria-label="Prévia das alterações"
              tabIndex={0}
              className="max-h-40 overflow-auto rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground-muted [overflow-wrap:anywhere]"
            >
              {preview}
            </pre>
          ) : null}
        </div>
      );
    }
    case 'secret':
      return (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-foreground-muted">Arquivo de segredo</p>
          <p className="break-all font-mono text-[12px] text-foreground-muted">{detail.path}</p>
          <p className="text-[11px] leading-snug text-warning">
            O conteúdo deste arquivo não é mostrado ao agente.
          </p>
        </div>
      );
    case 'outside':
      return (
        <div className="flex flex-col gap-1">
          <p className="break-all font-mono text-[12px] text-foreground-muted">{detail.path}</p>
          <p className="text-[11px] leading-snug text-warning">
            O caminho fica fora do workspace. Permitir acesso?
          </p>
        </div>
      );
    case 'other':
      return (
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground-muted">
          {detail.text}
        </p>
      );
    default:
      return null;
  }
}

