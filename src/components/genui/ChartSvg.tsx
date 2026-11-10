import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/i18n/format';
import type { ChartDatum, ChartSpec } from '@/lib/genui/schema';

export interface ChartSvgProps {
  spec: ChartSpec;
  className?: string;
  height?: number;
}

const VIEW_WIDTH = 520;
const PIE_COLORS = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--foreground-muted)',
  'var(--accent-hover)',
  'var(--foreground-subtle)',
];

function formatValue(value: number, suffix?: string): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1_000_000) {
    text = `${formatNumber(value / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  } else if (abs >= 1000) {
    text = `${formatNumber(value / 1000, { maximumFractionDigits: abs >= 10_000 ? 0 : 1 })}K`;
  } else if (Number.isInteger(value)) {
    text = formatNumber(value);
  } else {
    text = formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return suffix ? `${text}${suffix}` : text;
}

function truncateLabel(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Dependency-free SVG charts (bar/line/pie) used by both ` ```chart ` blocks and
 * the `chart` primitive of the generative UI. Token-based colors, aria-labeled.
 */
export function ChartSvg({ spec, className, height = 220 }: ChartSvgProps) {
  const { t } = useTranslation('genui');
  const gradientId = `zylara-chart-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const data = useMemo(() => spec.data.filter((entry) => Number.isFinite(entry.value)), [spec.data]);
  const title = spec.title ?? t('chart.title', { count: data.length });

  if (!data.length) {
    return (
      <div className={cn('flex h-24 items-center justify-center text-xs text-foreground-subtle', className)}>
        {t('chart.noData')}
      </div>
    );
  }

  return (
    <figure className={cn('flex w-full flex-col gap-2', className)}>
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="h-auto w-full text-foreground"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{title}</title>
        {spec.type === 'pie' ? (
          <PieChart data={data} height={height} />
        ) : spec.type === 'line' ? (
          <LineChart data={data} height={height} gradientId={gradientId} suffix={spec.suffix} />
        ) : (
          <BarChart data={data} height={height} suffix={spec.suffix} />
        )}
      </svg>
      {spec.type === 'pie' ? (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1">
          {data.map((entry, index) => (
            <span key={`${entry.label}-${index}`} className="inline-flex items-center gap-1.5 text-[11px] text-foreground-muted">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
              />
              {truncateLabel(entry.label, 24)}
              <span className="tabular-nums text-foreground-subtle">{formatValue(entry.value, spec.suffix)}</span>
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}

function GridAndAxis({
  height,
  max,
  ticks = 4,
}: {
  height: number;
  max: number;
  ticks?: number;
}) {
  const left = 44;
  const right = 12;
  const top = 14;
  const bottom = 26;
  const plotWidth = VIEW_WIDTH - left - right;
  const plotHeight = height - top - bottom;
  const lines = Array.from({ length: ticks + 1 }, (_, index) => {
    const ratio = index / ticks;
    return {
      y: top + plotHeight * (1 - ratio),
      value: max * ratio,
    };
  });

  return (
    <g aria-hidden>
      {lines.map((line) => (
        <g key={line.y}>
          <line
            x1={left}
            x2={left + plotWidth}
            y1={line.y}
            y2={line.y}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray={line.value === 0 ? undefined : '3 5'}
          />
          <text x={left - 6} y={line.y + 3} textAnchor="end" fontSize={9.5} fill="var(--foreground-subtle)">
            {formatValue(line.value)}
          </text>
        </g>
      ))}
      <line
        x1={left}
        x2={left + plotWidth}
        y1={top + plotHeight}
        y2={top + plotHeight}
        stroke="var(--border-strong)"
        strokeWidth={1}
      />
    </g>
  );
}

function BarChart({ data, height, suffix }: { data: ChartDatum[]; height: number; suffix?: string }) {
  const left = 44;
  const right = 12;
  const top = 14;
  const bottom = 26;
  const plotWidth = VIEW_WIDTH - left - right;
  const plotHeight = height - top - bottom;
  const max = niceMax(Math.max(...data.map((entry) => entry.value)));
  const slot = plotWidth / data.length;
  const barWidth = Math.max(4, Math.min(38, slot * 0.58));
  const showValues = data.length <= 12;

  return (
    <g>
      <GridAndAxis height={height} max={max} />
      {data.map((entry, index) => {
        const barHeight = Math.max(1, (entry.value / max) * plotHeight);
        const x = left + slot * index + (slot - barWidth) / 2;
        const y = top + plotHeight - barHeight;
        const labelStep = Math.ceil(data.length / 8);
        return (
          <g key={`${entry.label}-${index}`}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill="var(--accent)" opacity={0.9} />
            {showValues ? (
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="var(--foreground-muted)">
                {formatValue(entry.value, suffix)}
              </text>
            ) : null}
            {index % labelStep === 0 ? (
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--foreground-subtle)"
              >
                {truncateLabel(entry.label, Math.max(6, Math.floor(slot / 6)))}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function LineChart({
  data,
  height,
  gradientId,
  suffix,
}: {
  data: ChartDatum[];
  height: number;
  gradientId: string;
  suffix?: string;
}) {
  const left = 44;
  const right = 12;
  const top = 14;
  const bottom = 26;
  const plotWidth = VIEW_WIDTH - left - right;
  const plotHeight = height - top - bottom;
  const max = niceMax(Math.max(...data.map((entry) => entry.value)));
  const points = data.map((entry, index) => {
    const x = data.length === 1 ? left + plotWidth / 2 : left + (plotWidth * index) / (data.length - 1);
    const y = top + plotHeight - (entry.value / max) * plotHeight;
    return { x, y, entry };
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const area = `${line} L${points[points.length - 1]?.x ?? left},${top + plotHeight} L${points[0]?.x ?? left},${top + plotHeight} Z`;
  const labelStep = Math.ceil(data.length / 8);

  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <GridAndAxis height={height} max={max} />
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((point, index) => (
        <g key={`${point.entry.label}-${index}`}>
          <circle cx={point.x} cy={point.y} r={3} fill="var(--accent)" stroke="var(--surface-raised)" strokeWidth={1.5} />
          {data.length <= 12 ? (
            <text x={point.x} y={point.y - 8} textAnchor="middle" fontSize={9} fill="var(--foreground-muted)">
              {formatValue(point.entry.value, suffix)}
            </text>
          ) : null}
          {index % labelStep === 0 ? (
            <text x={point.x} y={height - 8} textAnchor="middle" fontSize={9.5} fill="var(--foreground-subtle)">
              {truncateLabel(point.entry.label, 10)}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

function PieChart({ data, height }: { data: ChartDatum[]; height: number }) {
  const { t } = useTranslation('genui');
  const total = data.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
  if (total <= 0) {
    return (
      <text x={VIEW_WIDTH / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="var(--foreground-subtle)">
        {t('chart.invalidValues')}
      </text>
    );
  }

  const cx = height / 2 + 8;
  const cy = height / 2;
  const radius = Math.min(height / 2 - 16, 88);
  const innerRadius = radius * 0.58;
  let angle = -Math.PI / 2;

  const arcs = data.map((entry, index) => {
    const sweep = (Math.max(0, entry.value) / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const largeArc = sweep > Math.PI ? 1 : 0;
    const x1 = cx + radius * Math.cos(start);
    const y1 = cy + radius * Math.sin(start);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    const x3 = cx + innerRadius * Math.cos(end);
    const y3 = cy + innerRadius * Math.sin(end);
    const x4 = cx + innerRadius * Math.cos(start);
    const y4 = cy + innerRadius * Math.sin(start);
    const path =
      sweep >= Math.PI * 2 - 0.0001
        ? `M${cx + radius},${cy} A${radius},${radius} 0 1 1 ${cx - radius},${cy} A${radius},${radius} 0 1 1 ${cx + radius},${cy} M${cx + innerRadius},${cy} A${innerRadius},${innerRadius} 0 1 0 ${cx - innerRadius},${cy} A${innerRadius},${innerRadius} 0 1 0 ${cx + innerRadius},${cy}`
        : `M${x1},${y1} A${radius},${radius} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${x4},${y4} Z`;
    return { path, color: PIE_COLORS[index % PIE_COLORS.length], entry, percent: (entry.value / total) * 100 };
  });

  return (
    <g>
      {arcs.map((arc, index) => (
        <path key={`${arc.entry.label}-${index}`} d={arc.path} fill={arc.color} stroke="var(--surface-raised)" strokeWidth={1.5} />
      ))}
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--foreground)">
        {formatValue(total)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9} fill="var(--foreground-subtle)">
        {t('chart.total')}
      </text>
      {arcs.map((arc, index) => {
        const y = 26 + index * 17;
        if (y > height - 8) return null;
        return (
          <g key={`legend-${arc.entry.label}-${index}`}>
            <rect x={height + 28} y={y - 7} width={8} height={8} rx={2} fill={arc.color} />
            <text x={height + 42} y={y} fontSize={10} fill="var(--foreground-muted)">
              {truncateLabel(arc.entry.label, 18)}
            </text>
            <text x={VIEW_WIDTH - 8} y={y} fontSize={10} textAnchor="end" fill="var(--foreground-subtle)">
              {formatNumber(arc.percent, { maximumFractionDigits: 0 })}%
            </text>
          </g>
        );
      })}
    </g>
  );
}
