import {
  Braces,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Film,
  Globe,
  Music2,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { normalizeLanguage, prism } from '@/lib/highlight';
import type { Artifact, ArtifactKind } from '@/lib/types';

export interface ArtifactKindMeta {
  kind: ArtifactKind;
  label: string;
  icon: LucideIcon;
  /** Token classes for the icon tile. */
  tone: string;
  description: string;
}

const META: Record<ArtifactKind, Omit<ArtifactKindMeta, 'kind'>> = {
  markdown: {
    label: 'Markdown',
    icon: FileText,
    tone: 'bg-accent-soft text-accent',
    description: 'Documento Markdown',
  },
  code: {
    label: 'Código',
    icon: FileCode2,
    tone: 'bg-accent-soft text-accent',
    description: 'Arquivo de código',
  },
  text: {
    label: 'Texto',
    icon: FileType2,
    tone: 'bg-surface-hover text-foreground-muted',
    description: 'Texto simples',
  },
  html: {
    label: 'HTML',
    icon: Globe,
    tone: 'bg-warning-soft text-warning',
    description: 'Página HTML',
  },
  csv: {
    label: 'CSV',
    icon: FileSpreadsheet,
    tone: 'bg-success-soft text-success',
    description: 'Planilha CSV',
  },
  json: {
    label: 'JSON',
    icon: Braces,
    tone: 'bg-warning-soft text-warning',
    description: 'Dados JSON',
  },
  svg: {
    label: 'SVG',
    icon: FileImage,
    tone: 'bg-accent-soft text-accent',
    description: 'Gráfico vetorial',
  },
  image: {
    label: 'Imagem',
    icon: FileImage,
    tone: 'bg-success-soft text-success',
    description: 'Imagem',
  },
  pdf: {
    label: 'PDF',
    icon: FileText,
    tone: 'bg-danger-soft text-danger',
    description: 'Documento PDF',
  },
  docx: {
    label: 'Documento',
    icon: FileText,
    tone: 'bg-accent-soft text-accent',
    description: 'Documento Word',
  },
  xlsx: {
    label: 'Planilha',
    icon: FileSpreadsheet,
    tone: 'bg-success-soft text-success',
    description: 'Planilha Excel',
  },
  pptx: {
    label: 'Apresentação',
    icon: Presentation,
    tone: 'bg-warning-soft text-warning',
    description: 'Apresentação PowerPoint',
  },
  audio: {
    label: 'Áudio',
    icon: Music2,
    tone: 'bg-accent-soft text-accent',
    description: 'Arquivo de áudio',
  },
  video: {
    label: 'Vídeo',
    icon: Film,
    tone: 'bg-warning-soft text-warning',
    description: 'Arquivo de vídeo',
  },
  archive: {
    label: 'Arquivo compactado',
    icon: FileArchive,
    tone: 'bg-surface-hover text-foreground-muted',
    description: 'Pacote ZIP',
  },
  binary: {
    label: 'Arquivo',
    icon: FileArchive,
    tone: 'bg-surface-hover text-foreground-muted',
    description: 'Arquivo binário',
  },
};

export function artifactKindMeta(kind: ArtifactKind): ArtifactKindMeta {
  const meta = META[kind] ?? META.binary;
  return { kind, ...meta };
}

/**
 * Languages that a kind already implies; stronger than the file extension
 * (e.g. `.md` artifacts always highlight as Markdown, never as something else).
 */
const KIND_DEFAULT_LANGUAGE: Partial<Record<ArtifactKind, string>> = {
  markdown: 'markdown',
  html: 'markup',
  svg: 'markup',
  csv: 'csv',
  json: 'json',
};

/** Kinds whose language comes from the file name / explicit hint. */
const INFERRED_KINDS = new Set<ArtifactKind>(['code', 'text']);

/**
 * Language hints tried for a file name, from most to least specific: the full
 * base name (`Dockerfile`, `CMakeLists.txt`, `.gitignore`) and the extension
 * (`main.py` → `py`). `normalizeLanguage` resolves both shapes.
 */
function nameLanguageHints(name: string): string[] {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  const withoutDot = base.startsWith('.') ? base.slice(1) : base;
  if (!withoutDot) return [];
  const hints = [withoutDot];
  const dot = withoutDot.lastIndexOf('.');
  if (dot > 0) hints.push(withoutDot.slice(dot + 1));
  return hints.filter((hint) => hint.length > 0);
}

/** True when Prism has a grammar (or the plain-text pseudo language) for `id`. */
function isSupportedLanguage(id: string): boolean {
  return id === 'text' || Boolean(prism.languages[id]);
}

/**
 * Prism language id used by the textual previews. Prefers the language the
 * backend detected, falls back to the kind default and then to the file
 * extension / full name (`main.py` → `python`, `Dockerfile` → `docker`).
 */
export function artifactLanguage(artifact: Artifact): string {
  const explicit = artifact.language?.trim();
  if (explicit) return normalizeLanguage(explicit);

  const kindDefault = KIND_DEFAULT_LANGUAGE[artifact.kind];
  if (kindDefault) return kindDefault;

  if (INFERRED_KINDS.has(artifact.kind)) {
    for (const hint of nameLanguageHints(artifact.name)) {
      const language = normalizeLanguage(hint);
      if (isSupportedLanguage(language)) return language;
    }
  }

  return 'text';
}
