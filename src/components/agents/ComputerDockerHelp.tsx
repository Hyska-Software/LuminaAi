import { Container, Copy, RefreshCw, Settings2, Terminal } from 'lucide-react';
import { toast } from 'sonner';

import { Button, IconButton } from '@/components/ui';
import { copyText } from '@/lib/utils';

const DEFAULT_COMPUTER_IMAGE = 'lumina/computer:latest';

/** Backend prefix for failures while starting the graphical Docker backend. */
export function isComputerDockerError(error: string): boolean {
  return error.includes('COMPUTER_DOCKER_FAILED');
}

/** Extracts the image name between backticks from the backend message. */
function dockerImageFromError(error: string): string {
  return error.match(/`([^`]+)`/)?.[1] ?? DEFAULT_COMPUTER_IMAGE;
}

/**
 * Actionable empty state for a failed private desktop. The raw Docker error is
 * kept behind "Detalhes técnicos"; the visible copy explains the exact setup
 * (daemon, local image, settings) instead of asking the user to decode Docker.
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
  const buildCommand = `docker build -t ${image} docker/computer`;

  const copyCommand = async () => {
    if (await copyText(buildCommand)) toast.success('Comando copiado');
    else toast.error('Não foi possível copiar o comando');
  };

  return (
    <div role="alert" className="flex w-full flex-col gap-3 p-4 text-left">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-danger/30 bg-danger-soft text-danger">
          <Container aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground">
            Docker do Desktop privado não está configurado
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-muted">
            A imagem gráfica <code className="font-mono text-[10px] text-foreground">{image}</code>{' '}
            não está disponível no daemon local. O Lumina não baixa imagens automaticamente.
          </p>        </div>
      </div>

      <ol className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        <li className="flex gap-2">
          <span className="font-medium text-foreground">1.</span>
          <span>Instale/abra o Docker Desktop (ou inicie o daemon) e confirme que ele está respondendo.</span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground">2.</span>
          <span>
            Na raiz do repositório do Lumina, construa a imagem gráfica abaixo — ou use outra
            imagem já publicada e informe em Configurações → Ferramentas → Imagem do computer use.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground">3.</span>
          <span>
            Para imagens privadas, rode <code className="font-mono text-[10px]">docker login</code>{' '}
            e faça o pull antes de tentar novamente.
          </span>
        </li>
      </ol>

      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5">
        <Terminal aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
          {buildCommand}
        </code>
        <IconButton
          label="Copiar comando de build"
          size="sm"
          variant="ghost"
          onClick={() => void copyCommand()}
        >
          <Copy aria-hidden className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          <Settings2 className="mr-1.5 size-3.5" />
          Configurar Docker
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RefreshCw className="mr-1.5 size-3.5" />
          Tentar de novo
        </Button>
      </div>

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
