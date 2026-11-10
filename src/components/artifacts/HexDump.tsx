import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Bytes shown per line in the hexdump (classic `xxd` layout). */
export const HEXDUMP_BYTES_PER_LINE = 16;

export interface HexDumpLine {
  /** Byte offset of the first byte of the line. */
  offset: number;
  /** Offset formatted as 8 lowercase hexadecimal digits (e.g. `00000010`). */
  offsetHex: string;
  /** Space-separated lowercase hex pairs of the bytes in the line. */
  hex: string;
  /** Printable representation: ASCII 0x20–0x7e kept, anything else becomes `.`. */
  ascii: string;
  /** Raw bytes of the line. */
  bytes: number[];
}

function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

function pad2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/**
 * Decodes a base64 payload (as sent by `get_artifact_preview`) into bytes.
 * Never throws: malformed input yields an empty array so the panel can show an
 * empty state instead of crashing.
 */
export function decodeBase64ToBytes(base64: string | null | undefined): Uint8Array {
  if (!base64) return new Uint8Array(0);
  const cleaned = base64.replace(/\s+/g, '');
  if (!cleaned) return new Uint8Array(0);
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index) & 0xff;
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Formats raw bytes as hexdump lines: 8-digit hex offset, 16 bytes per line
 * and the ASCII column on the right. `maxBytes` truncates the dump (the backend
 * sends at most the first ~4 KiB of the file).
 */
export function formatHexDump(
  bytes: Uint8Array,
  options: { maxBytes?: number } = {},
): HexDumpLine[] {
  const limit =
    options.maxBytes != null && Number.isFinite(options.maxBytes)
      ? Math.max(0, Math.floor(options.maxBytes))
      : bytes.length;
  const total = Math.min(bytes.length, limit);
  const lines: HexDumpLine[] = [];

  for (let offset = 0; offset < total; offset += HEXDUMP_BYTES_PER_LINE) {
    const end = Math.min(offset + HEXDUMP_BYTES_PER_LINE, total);
    const slice = Array.from(bytes.subarray(offset, end));
    lines.push({
      offset,
      offsetHex: offset.toString(16).padStart(8, '0'),
      hex: slice.map(pad2).join(' '),
      ascii: slice.map((byte) => (isPrintable(byte) ? String.fromCharCode(byte) : '.')).join(''),
      bytes: slice,
    });
  }

  return lines;
}

/** Convenience for tests/UI: base64 → hexdump lines, truncated at `maxBytes`. */
export function formatHexDumpLines(base64: string, maxBytes?: number): HexDumpLine[] {
  return formatHexDump(decodeBase64ToBytes(base64), { maxBytes });
}

export interface HexDumpProps {
  /** Base64 payload to dump. */
  base64?: string | null;
  /** Pre-decoded bytes; takes precedence over `base64`. */
  bytes?: Uint8Array;
  /** Maximum number of bytes to show (defaults to the whole payload). */
  maxBytes?: number;
  /** Accessible name of the scrollable region. */
  label?: string;
  className?: string;
}

/**
 * Monospaced hexdump: offset · 16 hex pairs · `|ASCII|`. Rendered in a
 * horizontally scrollable region so wide dumps never break the panel layout.
 */
export function HexDump({ base64, bytes, maxBytes, label, className }: HexDumpProps) {
  const { t } = useTranslation('artifacts');
  const lines = useMemo(() => {
    const data = bytes ?? decodeBase64ToBytes(base64);
    return formatHexDump(data, { maxBytes });
  }, [base64, bytes, maxBytes]);

  if (!lines.length) {
    return (
      <p className={cn('rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-foreground-subtle', className)}>
        {t('artifacts:hexdump.empty')}
      </p>
    );
  }

  return (
    <div
      role="region"
      aria-label={label ?? t('artifacts:hexdump.defaultLabel')}
      data-testid="hexdump"
      className={cn(
        'overflow-auto rounded-lg border border-border bg-surface p-2 font-mono text-[11px] leading-relaxed',
        className,
      )}
    >
      <div className="w-max min-w-full">
        {lines.map((line) => (
          <div key={line.offset} className="flex whitespace-pre">
            <span aria-hidden className="select-none pr-3 text-foreground-subtle">
              {line.offsetHex}
            </span>
            <span className="text-foreground">{line.hex.padEnd(HEXDUMP_BYTES_PER_LINE * 3 - 1, ' ')}</span>
            <span className="pl-3 text-foreground-muted">{`|${line.ascii}|`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
