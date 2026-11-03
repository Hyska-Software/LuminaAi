import { useState } from 'react';
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
  const image = dockerImageFromError(error);
  const pullCommand = `docker pull ${image}`;
  const buildCommand = `docker build -t ${image} docker/computer`;
  const [downloading, setDownloading] = useState(false);

  const copy = async (value: string, label: string) => {
    if (await copyText(value)) toast.success(label);
    else toast.error('Não foi possível copiar o comando');
  };

  const download = async () => {
    setDownloading(true);
    try {
      await api.dockerPullImage(image);
      toast.success('Imagem baixada', { description: image });
      onRetry();
    } catch (caught) {
      toast.error('Não foi possível baixar a imagem', { description: String(caught) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div role="alert" className="flex w-full flex-col gap-3 p-4 text-left">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-danger/30 bg-danger-soft text-danger">
          <Container aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground">
            Imagem do Desktop privado não está disponível
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-muted">
            A imagem gráfica <code className="font-mono text-[10px] text-foreground">{image}</code>{' '}
            não foi encontrada no Docker local. Baixe a imagem publicada ou configure outra em
            Configurações → Ferramentas.
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        <li className="flex gap-2">
          <span className="font-medium text-foreground">1.</span>
          <span>Instale/abra o Docker Desktop (ou inicie o daemon) e confirme que ele está respondendo.</span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground">2.</span>
          <span>
            Baixe a imagem publicada com o botão abaixo. Para imagens privadas, rode{' '}
            <code className="font-mono text-[10px]">docker login</code> no registry antes.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground">3.</span>
          <span>
            Se preferir outra imagem, informe o nome em Configurações → Ferramentas → Imagem do
            computer use e faça o download.
          </span>
        </li>
      </ol>

      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5">
        <Terminal aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
          {pullCommand}
        </code>
        <IconButton
          label="Copiar comando docker pull"
          size="sm"
          variant="ghost"
          onClick={() => void copy(pullCommand, 'Comando copiado')}
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
          Baixar imagem
        </Button>
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          <Settings2 className="mr-1.5 size-3.5" />
          Configurar Docker
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry} disabled={downloading}>
          <RefreshCw className="mr-1.5 size-3.5" />
          Tentar de novo
        </Button>
      </div>

      <details className="rounded-lg border border-border bg-surface/50 px-2.5 py-2">
        <summary className="cursor-pointer select-none text-[10px] font-medium text-foreground-subtle">
          Build local (desenvolvimento)
        </summary>
        <p className="mt-1.5 text-[10px] leading-relaxed text-foreground-muted">
          Na raiz do repositório do Lumina, construa a imagem gráfica:
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
            {buildCommand}
          </code>
          <IconButton
            label="Copiar comando docker build"
            size="sm"
            variant="ghost"
            onClick={() => void copy(buildCommand, 'Comando copiado')}
          >
            <Copy aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </details>

      <details className="rounded-lg border border-border bg-surface/50 px-2.5 py-2">
        <summary className="cursor-pointer select-none text-[10px] font-medium text-foreground-subtle">
          Detalhes técnicos
        </summary>
        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-danger">
          {error}
        </pre>
      </details>
    </div>
  );
}
