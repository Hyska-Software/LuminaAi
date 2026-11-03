import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { SkillContent, SkillSummary, SkillVersion } from '@/lib/types';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
  Spinner,
} from '@/components/ui';
import { Markdown } from '@/components/chat/Markdown';
import { CodeBlock } from '@/components/genui';
import { skillSourceMeta } from './sources';

type PreviewMode = 'document' | 'code';

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: SkillContent };

const VIEW_OPTIONS = [
  { value: 'document', label: 'Documento' },
  { value: 'code', label: 'Código' },
];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SkillPreviewDialogProps {
  /** Skill selected in the list. The dialog is mounted only while one is selected. */
  skill: SkillSummary;
  /** Called on Esc, overlay click or the header X. */
  onClose: () => void;
}

/**
 * Read-only preview of a skill's `SKILL.md` body (FILES §7.4), fetched on demand
 * from `get_skill_content`. The document uses the exact chat Markdown pipeline
 * (GFM + KaTeX + `.lumina-prose`); the "Código" tab shows the raw Markdown in a
 * `CodeBlock`. The frontmatter is stripped by the backend and never displayed.
 */
export function SkillPreviewDialog({ skill, onClose }: SkillPreviewDialogProps) {
  const meta = skillSourceMeta(skill.source);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<PreviewMode>('document');
  const [versions, setVersions] = useState<SkillVersion[]>([]);

  useEffect(() => {
    if (skill.source !== 'user') {
      setVersions([]);
      return;
    }
    let cancelled = false;
    api
      .listSkillVersions(skill.name)
      .then((list) => {
        if (!cancelled) setVersions(list);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skill.name, skill.source]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getSkillContent(skill.name)
      .then((content) => {
        if (!cancelled) setState({ status: 'ready', content });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [skill.name, attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  };

  const content = state.status === 'ready' ? state.content.content : '';
  const empty = state.status === 'ready' && !content.trim();
  const showToolbar = state.status === 'ready' && !empty;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="2xl" className="gap-0">
        <DialogHeader className="gap-2 pr-12">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <DialogTitle className="font-mono text-[16px] leading-6">{skill.name}</DialogTitle>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {!skill.enabled ? <Badge tone="muted">Desativada</Badge> : null}
          </div>
          <DialogDescription>{skill.description}</DialogDescription>
          {versions.length > 0 ? (
            <details className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] text-foreground-muted">
              <summary className="cursor-pointer select-none">
                Histórico de versões ({versions.length})
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
                {versions.slice(0, 10).map((version) => (
                  <li key={version.file} className="truncate">
                    {version.file} · {new Date(version.savedAt).toLocaleString('pt-BR')}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </DialogHeader>

        {showToolbar ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-y border-border bg-surface px-6 py-1.5">
            <SegmentedControl
              size="sm"
              ariaLabel="Modo de visualização da skill"
              options={VIEW_OPTIONS}
              value={mode}
              onChange={(value) => setMode(value === 'code' ? 'code' : 'document')}
            />
          </div>
        ) : null}

        <div
          role="region"
          aria-label={`Conteúdo da skill ${skill.name}`}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {state.status === 'loading' ? (
            <div
              role="status"
              className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 py-8"
            >
              <Spinner size="md" className="text-accent" />
              <span className="text-xs text-foreground-muted">Carregando conteúdo da skill…</span>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div
              role="alert"
              className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 py-8 text-center"
            >
              <AlertTriangle aria-hidden className="size-5 text-danger" />
              <p className="text-[13px] font-medium text-foreground">
                Não foi possível carregar o conteúdo da skill
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                {state.message}
              </p>
              <Button size="sm" variant="secondary" onClick={retry}>
                Tentar novamente
              </Button>
            </div>
          ) : null}

          {empty ? (
            <div className="flex min-h-[280px] items-center justify-center px-6 py-8 text-center">
              <p className="text-[13px] leading-relaxed text-foreground-muted">
                Esta skill não tem instruções.
              </p>
            </div>
          ) : null}

          {state.status === 'ready' && !empty && mode === 'document' ? (
            <div className="px-6 py-4">
              <Markdown content={content} />
            </div>
          ) : null}

          {state.status === 'ready' && !empty && mode === 'code' ? (
            <div className="p-3">
              <CodeBlock
                code={content}
                language="markdown"
                title="SKILL.md"
                showLineNumbers
                wrap={false}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
