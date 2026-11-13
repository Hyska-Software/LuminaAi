import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Container, Copy, Download, RefreshCw, Settings2, Terminal } from 'lucide-react';
import { toast } from 'sonner';

import { Button, IconButton, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { DEFAULT_COMPUTER_DOCKER_IMAGE } from '@/lib/computerDocker';
import { copyText } from '@/lib/utils';

/** Backend prefix for failures while starting the graphical Docker backend. */
export function isComputerDockerError(error: string): boolean {
  return error.includes('COMPUTER_DOCKER_FAILED');
}

/** Extracts the image name between backticks from the backend message. */
function dockerImageFromError(error: string): string {
  return error.match(/`([^`]+)`/)?.[1] ?? DEFAULT_COMPUTER_DOCKER_IMAGE;
}

/**
 * Actionable empty state for a failed private desktop. The visible copy
 * explains the published-image flow (pull/download) and keeps the raw Docker
 * error and the local build alternative behind details.
 */
export function ComputerDockerHelp({
  error,
  onRetry,
  onOpenSettings,
}: {
  error: string;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation('agents');
  const image = dockerImageFromError(error);
  const pullCommand = `docker pull ${image}`;
  const buildCommand = `docker build -t ${image} docker/computer`;
  const [downloading, setDownloading] = useState(false);

  const copy = async (value: string, label: string) => {
    if (await copyText(value)) toast.success(label);
    else toast.error(t('dockerHelp.copyError'));
  };

  const download = async () => {
    setDownloading(true);
    try {
      await api.dockerPullImage(image);
      toast.success(t('dockerHelp.downloaded'), { description: image });
      onRetry();
    } catch (caught) {
      toast.error(t('dockerHelp.downloadError'), { description: String(caught) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div role="alert" className="flex w-full flex-col gap-3 p-4 text-left">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <Container aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground">
            {t('dockerHelp.title')}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-muted">
            {t('dockerHelp.missingImage', { image })}
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        <li className="flex gap-2">
          <span className="font-medium text-foreground">1.</span>
          <span>{t('dockerHelp.steps.docker')}</span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground">2.</span>
          <span>{t('dockerHelp.steps.download')}</span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground">3.</span>
          <span>{t('dockerHelp.steps.customImage')}</span>
        </li>
      </ol>

      <div className="flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5">
        <Terminal aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
          {pullCommand}
        </code>
        <IconButton
          label={t('dockerHelp.copyPullAria')}
          size="sm"
          variant="ghost"
          onClick={() => void copy(pullCommand, t('dockerHelp.copied'))}
        >
          <Copy aria-hidden className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={downloading} onClick={() => void download()}>
          {downloading ? (
            <Spinner className="mr-1.5 size-3.5" />
          ) : (
            <Download className="mr-1.5 size-3.5" />
          )}
          {t('dockerHelp.download')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          <Settings2 className="mr-1.5 size-3.5" />
          {t('dockerHelp.configure')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry} disabled={downloading}>
          <RefreshCw className="mr-1.5 size-3.5" />
          {t('dockerHelp.retry')}
        </Button>
      </div>

      <details className="rounded-lg bg-surface px-2.5 py-2">
        <summary className="cursor-pointer select-none text-[10px] font-medium text-foreground-subtle">
          {t('dockerHelp.localBuild')}
        </summary>
        <p className="mt-1.5 text-[10px] leading-relaxed text-foreground-muted">
          {t('dockerHelp.localBuildHint')}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
            {buildCommand}
          </code>
          <IconButton
            label={t('dockerHelp.copyBuildAria')}
            size="sm"
            variant="ghost"
            onClick={() => void copy(buildCommand, t('dockerHelp.copied'))}
          >
            <Copy aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </details>

      <details className="rounded-lg bg-surface px-2.5 py-2">
        <summary className="cursor-pointer select-none text-[10px] font-medium text-foreground-subtle">
          {t('dockerHelp.technicalDetails')}
        </summary>
        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-danger">
          {error}
        </pre>
      </details>
    </div>
  );
}
