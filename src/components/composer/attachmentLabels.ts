import type { AttachmentInfo } from '@/lib/types';
import { t } from '@/lib/i18n';
import { formatBytes } from '@/lib/utils';

/** Generic kind labels (extensions/MIME take precedence). */
const KIND_FALLBACK_KEYS: Partial<Record<AttachmentInfo['kind'], string>> = {
  image: 'composer:attachments.kinds.image',
  text: 'composer:attachments.kinds.text',
  code: 'composer:attachments.kinds.code',
  unknown: 'composer:attachments.kinds.unknown',
};

/** Stable type tags that are the same in every language. */
const KIND_TAGS: Partial<Record<AttachmentInfo['kind'], string>> = {
  pdf: 'PDF',
  docx: 'DOCX',
  xlsx: 'XLSX',
  pptx: 'PPTX',
  csv: 'CSV',
  json: 'JSON',
};

function kindFallback(kind: AttachmentInfo['kind']): string {
  const tag = KIND_TAGS[kind];
  if (tag) return tag;
  const key = KIND_FALLBACK_KEYS[kind];
  return key ? t(key) : t('composer:attachments.kinds.unknown');
}

/**
 * Human-readable format label (PNG, PDF, TS, …). Prefers the file extension,
 * then the MIME subtype, then a generic kind label.
 */
export function attachmentFormatLabel(info: AttachmentInfo): string {
  const name = info.name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).trim() : '';
  if (extension && extension.length <= 8) return extension.toUpperCase();
  const subtype = info.mimeType.split(';')[0]?.split('/')[1]?.replace(/^x-/, '').trim();
  if (subtype) return subtype.toUpperCase();
  return kindFallback(info.kind);
}

/** Chip meta line: `PNG · 675×265 · 24 KB` / `PDF · 12 pág. · 400 KB`. */
export function describeAttachment(info: AttachmentInfo): string {
  const parts = [attachmentFormatLabel(info)];
  if (info.width && info.height) {
    parts.push(`${info.width}×${info.height}`);
  } else if (info.pageCount) {
    parts.push(t('composer:attachments.pages', { count: info.pageCount }));
  }
  parts.push(formatBytes(info.size));
  return parts.join(' · ');
}
