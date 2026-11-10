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
import { t } from '@/lib/i18n';
import type { Artifact, ArtifactKind } from '@/lib/types';

export interface ArtifactKindMeta {
  kind: ArtifactKind;
  /** Translation key of the short kind label. */
  labelKey: ArtifactKindLabelKey;
  /** Translation key of the one-line kind description. */
  descriptionKey: ArtifactKindDescriptionKey;
  /** Localized label, resolved on access so a language change is reflected. */
  readonly label: string;
  /** Localized description, resolved on access. */
  readonly description: string;
  icon: LucideIcon;
  /** Token classes for the icon tile. */
  tone: string;
}

type ArtifactKindLabelKey = `artifacts:kinds.${ArtifactKind}.label`;
type ArtifactKindDescriptionKey = `artifacts:kinds.${ArtifactKind}.description`;

type KindEntry = Omit<ArtifactKindMeta, 'kind' | 'label' | 'description'>;

function kindEntry(
  labelKey: ArtifactKindLabelKey,
  descriptionKey: ArtifactKindDescriptionKey,
  icon: LucideIcon,
  tone: string,
): KindEntry & { readonly label: string; readonly description: string } {
  return {
    labelKey,
    descriptionKey,
    icon,
    tone,
    get label() {
      return t(labelKey);
    },
    get description() {
      return t(descriptionKey);
    },
  };
}

const META: Record<ArtifactKind, Omit<ArtifactKindMeta, 'kind'>> = {
  markdown: kindEntry(
    'artifacts:kinds.markdown.label',
    'artifacts:kinds.markdown.description',
    FileText,
    'bg-accent-soft text-accent',
  ),
  code: kindEntry(
    'artifacts:kinds.code.label',
    'artifacts:kinds.code.description',
    FileCode2,
    'bg-accent-soft text-accent',
  ),
  text: kindEntry(
    'artifacts:kinds.text.label',
    'artifacts:kinds.text.description',
    FileType2,
    'bg-surface-hover text-foreground-muted',
  ),
  html: kindEntry(
    'artifacts:kinds.html.label',
    'artifacts:kinds.html.description',
    Globe,
    'bg-warning-soft text-warning',
  ),
  csv: kindEntry(
    'artifacts:kinds.csv.label',
    'artifacts:kinds.csv.description',
    FileSpreadsheet,
    'bg-success-soft text-success',
  ),
  json: kindEntry(
    'artifacts:kinds.json.label',
    'artifacts:kinds.json.description',
    Braces,
    'bg-warning-soft text-warning',
  ),
  svg: kindEntry(
    'artifacts:kinds.svg.label',
    'artifacts:kinds.svg.description',
    FileImage,
    'bg-accent-soft text-accent',
  ),
  image: kindEntry(
    'artifacts:kinds.image.label',
    'artifacts:kinds.image.description',
    FileImage,
    'bg-success-soft text-success',
  ),
  pdf: kindEntry(
    'artifacts:kinds.pdf.label',
    'artifacts:kinds.pdf.description',
    FileText,
    'bg-danger-soft text-danger',
  ),
  docx: kindEntry(
    'artifacts:kinds.docx.label',
    'artifacts:kinds.docx.description',
    FileText,
    'bg-accent-soft text-accent',
  ),
  xlsx: kindEntry(
    'artifacts:kinds.xlsx.label',
    'artifacts:kinds.xlsx.description',
    FileSpreadsheet,
    'bg-success-soft text-success',
  ),
  pptx: kindEntry(
    'artifacts:kinds.pptx.label',
    'artifacts:kinds.pptx.description',
    Presentation,
    'bg-warning-soft text-warning',
  ),
  audio: kindEntry(
    'artifacts:kinds.audio.label',
    'artifacts:kinds.audio.description',
    Music2,
    'bg-accent-soft text-accent',
  ),
  video: kindEntry(
    'artifacts:kinds.video.label',
    'artifacts:kinds.video.description',
    Film,
    'bg-warning-soft text-warning',
  ),
  archive: kindEntry(
    'artifacts:kinds.archive.label',
    'artifacts:kinds.archive.description',
    FileArchive,
    'bg-surface-hover text-foreground-muted',
  ),
  binary: kindEntry(
    'artifacts:kinds.binary.label',
    'artifacts:kinds.binary.description',
    FileArchive,
    'bg-surface-hover text-foreground-muted',
  ),
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
