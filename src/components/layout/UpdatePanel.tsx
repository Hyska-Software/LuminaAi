/**
 * Shared update panel: header, release notes and the download/install actions.
 * Used by the title-bar popover and by Settings → Sobre so both surfaces always
 * show the same phase and copy.
 */
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, ProgressBar } from '@/components/ui';
import { openExternalUrl } from '@/components/chat/external';
import { useUpdateStore } from '@/lib/store';
import { cn, formatBytes, relativeTime } from '@/lib/utils';

export function updateCheckedLabel(timestamp?: number | null): string | null {
  if (!timestamp) return null;
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'Verificado agora';
  if (diff < 45_000) return 'Verificado agora';
  if (diff < 7 * 24 * 60 * 60 * 1000) return `Verificado há ${relativeTime(timestamp)}`;
  return `Verificado em ${new Date(timestamp).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })}`;
}

function releasedLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `publicada em ${date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;
}

/** Removes the heavier Markdown noise so GitHub-generated notes read well in a
 *  small popover. Notes are always rendered as plain text (never HTML). */
function plainNotes(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

function installHint(kind: string | undefined): string {
  switch (kind) {
    case 'setup':
      return 'O Lumina será fechado durante a instalação. Suas conversas e configurações são mantidas.';
    case 'dmg':
      return 'Arraste o Lumina para a pasta Aplicativos e abra a nova versão.';
    case 'appimage':
      return 'Substitua o AppImage atual pelo novo arquivo e abra-o novamente.';
    case 'deb':
    case 'rpm':
      return 'O instalador do sistema será aberto para concluir a atualização.';
    default:
      return 'Siga as instruções do instalador para concluir a atualização.';
  }
}

function primaryLabel(kind: string | undefined): string {
  return kind === 'setup' ? 'Baixar e instalar' : 'Baixar atualização';
}

function installLabel(kind: string | undefined): string {
  switch (kind) {
    case 'setup':
      return 'Instalar agora';
    case 'dmg':
      return 'Abrir DMG';
    case 'appimage':
      return 'Abrir pasta';
    case 'deb':
    case 'rpm':
      return 'Abrir instalador';
    default:
      return 'Abrir instalador';
  }
}

function ErrorBox() {
  const error = useUpdateStore((state) => state.error);
  const errorScope = useUpdateStore((state) => state.errorScope);
  if (!error || (errorScope !== 'download' && errorScope !== 'install')) return null;
  return (
    <div
      role="alert"
      className="mt-3 flex gap-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-danger"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 break-words">{error}</span>
    </div>
  );
}

export function UpdateActions({ className }: { className?: string }) {
  const phase = useUpdateStore((state) => state.phase);
  const info = useUpdateStore((state) => state.info);
  const downloaded = useUpdateStore((state) => state.downloaded);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const errorScope = useUpdateStore((state) => state.errorScope);
  const startDownload = useUpdateStore((state) => state.download);
  const cancelDownload = useUpdateStore((state) => state.cancel);
  const install = useUpdateStore((state) => state.install);
  const reveal = useUpdateStore((state) => state.reveal);

  if (!info) return null;
  const kind = info.asset?.kind;

  if (phase === 'downloading' || phase === 'verifying') {
    const received = progress?.received ?? 0;
    const total = progress?.total ?? info.asset?.size ?? 0;
    const percent = progress?.percent ?? 0;
    return (
      <div className={cn('mt-3 flex flex-col gap-2', className)}>
        <span className="sr-only" aria-live="polite">
          {phase === 'verifying'
            ? 'Verificando a integridade do download'
            : 'Baixando a atualização'}
        </span>
        <div className="flex items-center justify-between gap-3 text-[11.5px]">
          <span className="text-foreground-muted">
            {phase === 'verifying'
              ? 'Verificando integridade…'
              : `${formatBytes(received)} de ${formatBytes(total)}`}
          </span>
          <span className="font-mono tabular-nums text-foreground-muted">
            {phase === 'verifying' ? '—' : `${Math.round(percent)}%`}
          </span>
        </div>
        <ProgressBar
          value={phase === 'verifying' ? null : percent}
          label="Download da atualização"
          size="sm"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] tabular-nums text-foreground-subtle">
            {phase === 'downloading' && progress
              ? `${formatBytes(progress.bytesPerSec)}/s`
              : 'Não feche o Lumina enquanto a verificação termina.'}
          </span>
          {phase === 'downloading' ? (
            <Button size="sm" variant="ghost" onClick={() => void cancelDownload()}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (phase === 'installing') {
    return (
      <div className={cn('mt-3', className)}>
        <Button size="md" className="w-full" loading>
          Abrindo instalador…
        </Button>
      </div>
    );
  }

  if (phase === 'ready' && downloaded) {
    return (
      <div className={cn('mt-3 flex flex-col gap-2', className)}>
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-success">
          <ShieldCheck className="size-3.5" strokeWidth={1.75} />
          Download verificado
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="md"
            className="flex-1"
            leftIcon={<CheckCircle2 className="size-4" strokeWidth={1.75} />}
            onClick={() => void install()}
          >
            {installLabel(kind)}
          </Button>
          <Button size="md" variant="secondary" onClick={() => void reveal()}>
            Abrir pasta
          </Button>
        </div>
        {error && errorScope === 'install' ? <ErrorBox /> : null}
        <p className="text-[11px] leading-relaxed text-foreground-subtle">{installHint(kind)}</p>
      </div>
    );
  }

  if (!info.asset) {
    return (
      <div className={cn('mt-3 flex flex-col gap-2', className)}>
        <p className="text-[11.5px] leading-relaxed text-foreground-muted">
          Esta versão não tem instalador para a sua plataforma. Abra a release no GitHub para baixar
          manualmente.
        </p>
        <Button
          size="md"
          variant="secondary"
          className="w-full"
          rightIcon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}
          onClick={() => void openExternalUrl(info.htmlUrl)}
        >
          Ver no GitHub
        </Button>
      </div>
    );
  }

  const checking = phase === 'checking';
  return (
    <div className={cn('mt-3', className)}>
      {error && errorScope === 'download' ? <ErrorBox /> : null}
      <Button
        size="md"
        className="mt-1 w-full"
        loading={checking}
        disabled={checking}
        onClick={() => void startDownload()}
      >
        {errorScope === 'download' && error ? 'Tentar novamente' : primaryLabel(kind)}
      </Button>
      <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
        {formatBytes(info.asset.size)} · {info.asset.platformLabel} · SHA-256
      </p>
    </div>
  );
}

export function UpdatePopoverBody({ onClose }: { onClose: () => void }) {
  const info = useUpdateStore((state) => state.info);
  const preferences = useUpdateStore((state) => state.preferences);
  const phase = useUpdateStore((state) => state.phase);
  const notes = useUpdateStore((state) =>
    info ? state.notes[info.latestVersion] : undefined,
  );
  const notesLoading = useUpdateStore((state) => state.notesLoading);
  const check = useUpdateStore((state) => state.check);
  const skip = useUpdateStore((state) => state.skip);
  const errorScope = useUpdateStore((state) => state.errorScope);

  if (!info) {
    const checking = phase === 'checking';
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-foreground-muted">
            {checking ? (
              <Loader2 className="size-[18px] animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
            ) : (
              <CheckCircle2 className="size-[18px]" strokeWidth={1.75} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold tracking-tight text-foreground">
              {checking ? 'Verificando atualizações…' : 'Tudo atualizado'}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-foreground-muted">
              {checking
                ? 'Buscando a versão mais recente no GitHub.'
                : 'Você está usando a versão mais recente do Lumina.'}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    );
  }

  const checkedAt = updateCheckedLabel(preferences.lastCheckAt);
  const released = releasedLabel(info.releasedAt);
  const notesText = notes?.notes ? plainNotes(notes.notes) : null;
  const loadingNotes = notesLoading === info.latestVersion;
  const checking = phase === 'checking';
  const stale = info.stale || errorScope === 'check';

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <ArrowUpCircle className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold tracking-tight text-foreground">
            Nova versão disponível
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-foreground-muted">
            {info.releaseName}
            {released ? ` · ${released}` : ''}
          </p>
        </div>
        <Badge tone="accent" size="sm">
          Nova
        </Badge>
      </div>

      {stale ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-foreground-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p>Não foi possível verificar agora. Mostrando o último resultado.</p>
            <button
              type="button"
              onClick={() => void check({ force: true })}
              className="mt-1 inline-flex items-center gap-1 font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <RefreshCw className={cn('size-3', checking && 'animate-spin')} strokeWidth={1.75} />
              Verificar novamente
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 border-t border-border pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
          Novidades
        </p>
        {loadingNotes ? (
          <div className="mt-2 flex flex-col gap-1.5" aria-label="Carregando novidades">
            <span className="h-2.5 w-11/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <span className="h-2.5 w-3/4 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <span className="h-2.5 w-2/3 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
          </div>
        ) : notesText ? (
          <div className="mt-1.5 max-h-36 overflow-y-auto whitespace-pre-line pr-1 text-[11.5px] leading-relaxed text-foreground-muted">
            {notesText}
          </div>
        ) : (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-muted">
            Veja o que mudou nesta versão no GitHub.
          </p>
        )}
        <button
          type="button"
          onClick={() => void openExternalUrl(notes?.htmlUrl ?? info.htmlUrl)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Ver no GitHub
          <ExternalLink className="size-3" strokeWidth={1.75} />
        </button>
      </div>

      <UpdateActions />

      {checkedAt ? (
        <p className="mt-2 text-center text-[10.5px] text-foreground-subtle">{checkedAt}</p>
      ) : null}

      {phase !== 'downloading' && phase !== 'verifying' && phase !== 'installing' ? (
        <div className="mt-2 flex flex-col items-center gap-1 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[11.5px] font-medium text-foreground-muted transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Agora não
          </button>
          <button
            type="button"
            onClick={() => void skip()}
            className="rounded-md px-2 py-0.5 text-[10.5px] text-foreground-subtle transition-colors duration-150 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Ignorar esta versão
          </button>
        </div>
      ) : null}
    </div>
  );
}
