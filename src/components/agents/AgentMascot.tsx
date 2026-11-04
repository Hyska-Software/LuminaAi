import { useId } from 'react';

import {
  AGENT_AVATAR_BODY_BY_ID,
  AGENT_AVATAR_COLOR_BY_ID,
  AGENT_AVATAR_EXPRESSION_BY_ID,
  featuresColorFor,
  type AgentAvatarExpressionSpec,
} from '@/lib/agentAvatar';
import type { AgentAvatar as AgentAvatarSpec } from '@/lib/types';
import { cn } from '@/lib/utils';

type MascotAvatar = AgentAvatarSpec & { kind: 'mascot' };

const FALLBACK_BODY = AGENT_AVATAR_BODY_BY_ID.get('mascot')!;
const FALLBACK_EXPRESSION = AGENT_AVATAR_EXPRESSION_BY_ID.get('neutral')!;
const FALLBACK_COLOR = AGENT_AVATAR_COLOR_BY_ID.get('blue')!;

/** Eyes use a single solid colour: no sclera and no pupil. */
function Eyes({
  shape,
  fill,
}: {
  shape: AgentAvatarExpressionSpec['eyes'];
  fill: string;
}) {
  switch (shape) {
    case 'wide':
      return (
        <>
          <ellipse cx={-11} cy={-5} rx={5.5} ry={7.5} fill={fill} />
          <ellipse cx={11} cy={-5} rx={5.5} ry={7.5} fill={fill} />
        </>
      );
    case 'arc':
      return (
        <>
          <path d="M-16 -3q5 7 10 0" fill="none" stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
          <path d="M6 -3q5 7 10 0" fill="none" stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
        </>
      );
    case 'wink':
      return (
        <>
          <path d="M-16 -3q5 7 10 0" fill="none" stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
          <ellipse cx={11} cy={-5} rx={4.5} ry={6.5} fill={fill} />
        </>
      );
    case 'angry':
      return (
        <>
          <path d="M-16 -8l9 5" fill="none" stroke={fill} strokeWidth={3} strokeLinecap="round" />
          <path d="M16 -8l-9 5" fill="none" stroke={fill} strokeWidth={3} strokeLinecap="round" />
        </>
      );
    case 'line':
      return (
        <>
          <path d="M-16 -5h10" fill="none" stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
          <path d="M6 -5h10" fill="none" stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
        </>
      );
    case 'half':
      return (
        <>
          <path d="M-16 -8h10v4a5 5 0 0 1-10 0Z" fill={fill} />
          <path d="M6 -8h10v4a5 5 0 0 1-10 0Z" fill={fill} />
        </>
      );
    case 'x':
      return (
        <>
          <path
            d="M-16 -10l10 10M-6 -10l-10 10"
            fill="none"
            stroke={fill}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <path
            d="M6 -10l10 10M16 -10l-10 10"
            fill="none"
            stroke={fill}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </>
      );
    case 'oval':
    default:
      return (
        <>
          <ellipse cx={-11} cy={-5} rx={4.5} ry={6.5} fill={fill} />
          <ellipse cx={11} cy={-5} rx={4.5} ry={6.5} fill={fill} />
        </>
      );
  }
}

function Mouth({ shape, fill }: { shape: AgentAvatarExpressionSpec['mouth']; fill: string }) {
  switch (shape) {
    case 'grin':
      return <path d="M-8 10q8 8 16 0Z" fill={fill} />;
    case 'open':
      return <ellipse cx={0} cy={12} rx={5} ry={4} fill={fill} />;
    case 'flat':
      return (
        <path d="M-6 12h12" fill="none" stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
      );
    case 'frown':
      return (
        <path
          d="M-7 14q7-6 14 0"
          fill="none"
          stroke={fill}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      );
    case 'smirk':
      return (
        <path
          d="M-6 11q6 4 12-1"
          fill="none"
          stroke={fill}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      );
    case 'wavy':
      return (
        <path
          d="M-7 12q3-4 6 0t6 0"
          fill="none"
          stroke={fill}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      );
    case 'small':
      return <circle cx={0} cy={12} r={2.5} fill={fill} />;
    case 'smile':
    default:
      return (
        <path
          d="M-7 10q7 6 14 0"
          fill="none"
          stroke={fill}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      );
  }
}

/** Built-in mascot renderer. All geometry lives in `agentAvatar.ts`. */
export function AgentMascot({
  avatar,
  className,
}: {
  avatar: MascotAvatar;
  className?: string;
}) {
  const rawId = useId();
  const gradientId = `agent-avatar-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const body = AGENT_AVATAR_BODY_BY_ID.get(avatar.body) ?? FALLBACK_BODY;
  const expression = AGENT_AVATAR_EXPRESSION_BY_ID.get(avatar.expression) ?? FALLBACK_EXPRESSION;
  const color = AGENT_AVATAR_COLOR_BY_ID.get(avatar.color) ?? FALLBACK_COLOR;
  const fill = color.gradient ? `url(#${gradientId})` : color.hex;
  const features = featuresColorFor(avatar.color);

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('size-full', className)}
      aria-hidden
      focusable="false"
    >
      {color.gradient ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color.gradient[0]} />
            <stop offset="100%" stopColor={color.gradient[1]} />
          </linearGradient>
        </defs>
      ) : null}
      {body.paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill={fill}
          stroke={fill}
          strokeWidth={body.strokeWidth ?? 6}
          strokeLinejoin="round"
        />
      ))}
      <g transform={`translate(${body.face.x} ${body.face.y}) scale(${body.face.scale})`}>
        <Eyes shape={expression.eyes} fill={features} />
        <Mouth shape={expression.mouth} fill={features} />
      </g>
    </svg>
  );
}
