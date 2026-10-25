import { splitHighlight } from '@/lib/palette/search';
import type { TextRanges } from '@/lib/palette/types';

export interface HighlightedTextProps {
  text: string;
  ranges?: TextRanges;
  className?: string;
}

/**
 * Renders `text` with the query matches highlighted (`<mark>`). Ranges are
 * computed by `lib/palette/search` on the original (accented) text, so the
 * markup never shifts the content.
 */
export function HighlightedText({ text, ranges = [], className }: HighlightedTextProps) {
  const segments = splitHighlight(text, ranges);
  const hasHighlight = segments.some((segment) => segment.highlighted);
  if (!hasHighlight) return <span className={className}>{text}</span>;

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark
            // eslint-disable-next-line react/no-array-index-key -- segments are positional
            key={index}
            className="rounded-[3px] bg-accent-soft px-0.5 text-accent"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

export default HighlightedText;
