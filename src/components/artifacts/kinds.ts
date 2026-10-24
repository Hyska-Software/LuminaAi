import {
  Braces,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Globe,
  type LucideIcon,
} from 'lucide-react';
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

/** Language hint used by prism for text-ish artifacts. */
export function artifactLanguage(artifact: Artifact): string {
  if (artifact.language) return artifact.language;
  switch (artifact.kind) {
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'html':
      return 'markup';
    case 'svg':
      return 'markup';
    case 'csv':
      return 'csv';
    default:
      return 'text';
  }
}
