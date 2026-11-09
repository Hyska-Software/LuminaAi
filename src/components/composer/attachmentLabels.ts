import type { AttachmentInfo } from '@/lib/types';
import { formatBytes } from '@/lib/utils';

const KIND_FALLBACK: Record<AttachmentInfo['kind'], string> = {
  image: 'Imagem',
  pdf: 'PDF',
  docx: 'DOCX',
  xlsx: 'XLSX',
  pptx: 'PPTX',
  text: 'Texto',
  code: 'Código',
  csv: 'CSV',
  json: 'JSON',
  unknown: 'Arquivo',
};

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
  return KIND_FALLBACK[info.kind];
}

/** Chip meta line: `PNG · 675×265 · 24 KB` / `PDF · 12 pág. · 400 KB`. */
export function describeAttachment(info: AttachmentInfo): string {
  const parts = [attachmentFormatLabel(info)];
  if (info.width && info.height) {
    parts.push(`${info.width}×${info.height}`);
  } else if (info.pageCount) {
    parts.push(`${info.pageCount} pág.`);
  }
  parts.push(formatBytes(info.size));
  return parts.join(' · ');
}
