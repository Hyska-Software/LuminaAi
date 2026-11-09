/**
 * Title-bar update indicator (DESIGN §5): a compact pill anchored to the top-right
 * corner, immediately before the native window controls.
 *
 * It is the always-visible surface for an available release and also carries
 * live feedback while the download runs. Clicking it opens the full panel with
 * notes, size/platform, download progress and the install action.
 */
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { useUpdateStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { UpdatePopoverBody } from './UpdatePanel';

type Tone = 'accent' | 'neutral' | 'success' | 'danger';

const TONES: Record<Tone, string> = {
  accent:
    'border-accent/30 bg-accent-soft text-accent hover:border-accent/50',
  neutral:
    'border-border bg-surface-raised text-foreground-muted hover:border-border-strong hover:text-foreground',
  success: 'border-success/30 bg-success-soft text-success hover:border-success/50',
  danger: 'border-danger/30 bg-danger-soft text-danger hover:border-danger/50',
};

export function UpdateChip() {
  const info = useUpdateStore((state) => state.info);
  const phase = useUpdateStore((state) => state.phase);
  const progress = useUpdateStore((state) => state.progress);
  const manualCheck = useUpdateStore((state) => state.manualCheck);
  const errorScope = useUpdateStore((state) => state.errorScope);
  const open = useUpdateStore((state) => state.open);
  const setOpen = useUpdateStore((state) => state.setOpen);

  const visible =
    Boolean(info?.available) ||
    (manualCheck && phase === 'checking') ||
    (phase === 'error' && errorScope === 'download');
  if (!visible) return null;

  const percent = Math.round(progress?.percent ?? 0);
  let tone: Tone = 'accent';
  let label = info ? `v${info.latestVersion} disponível` : 'Verificando…';
  let title = info ? `Atualização v${info.latestVersion} disponível` : 'Verificando atualizações';
  let Icon = ArrowUpCircle;
  let spin = false;

  switch (phase) {
    case 'checking':
      // A silent refresh of a known release keeps the "available" pill; only a
      // manual check without a known version shows the checking state.
      if (info) break;
      tone = 'neutral';
      label = 'Verificando…';
      title = 'Verificando atualizações';
      Icon = Loader2;
      spin = true;
      break;
    case 'downloading':
      tone = 'accent';
      label = `Baixando ${percent}%`;
      title = `Baixando atualização — ${percent}%`;
      Icon = Download;
      break;
    case 'verifying':
      tone = 'neutral';
      label = 'Verificando…';
      title = 'Verificando a integridade do download';
      Icon = ShieldCheck;
      break;
    case 'ready':
      tone = 'success';
      label = `Instalar v${info?.latestVersion ?? ''}`.trim();
      title = `Atualização v${info?.latestVersion ?? ''} pronta para instalar`.trim();
      Icon = CheckCircle2;
      break;
    case 'installing':
      tone = 'accent';
      label = 'Abrindo instalador…';
      title = 'Abrindo o instalador';
      Icon = Loader2;
      spin = true;
      break;
    case 'error':
      tone = 'danger';
      label = 'Falha na atualização';
      title = 'Falha na atualização';
      Icon = AlertTriangle;
      break;
    default:
      break;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            'no-drag relative flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-2.5',
            'text-[11.5px] font-medium leading-none tracking-tight transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'motion-reduce:transition-none',
            TONES[tone],
          )}
        >
          <Icon
            aria-hidden
            className={cn('size-3.5 shrink-0', spin && 'animate-spin motion-reduce:animate-none')}
            strokeWidth={1.75}
          />
          <span className="hidden whitespace-nowrap lg:inline">{label}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" strokeWidth={2} />
          {phase === 'downloading' ? (
            <span aria-hidden className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-accent/20">
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Atualização do Lumina"
        className="w-[360px] p-4"
      >
        <UpdatePopoverBody onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
