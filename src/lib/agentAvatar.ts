import type {
  AgentAvatar,
  AgentAvatarBody,
  AgentAvatarColor,
  AgentAvatarExpression,
  AgentAvatarFace,
  AgentAvatarShape,
} from './types';

export interface AgentAvatarBodySpec {
  value: AgentAvatarBody;
  labelKey: string;
  paths: readonly string[];
  face: { x: number; y: number; scale: number };
  strokeWidth?: number;
}

export interface AgentAvatarExpressionSpec {
  value: AgentAvatarExpression;
  labelKey: string;
  eyes: 'oval' | 'wide' | 'arc' | 'wink' | 'angry' | 'line' | 'half' | 'x';
  mouth: 'smile' | 'grin' | 'open' | 'flat' | 'frown' | 'smirk' | 'wavy' | 'small';
}

export interface AgentAvatarColorSpec {
  value: AgentAvatarColor;
  labelKey: string;
  hex: string;
  gradient?: readonly [string, string];
}

export const AGENT_AVATAR_SHAPES: readonly { value: AgentAvatarShape; labelKey: string }[] = [
  { value: 'mascot', labelKey: 'avatarLabels.shape.mascot' },
  { value: 'circle', labelKey: 'avatarLabels.shape.circle' },
  { value: 'rounded', labelKey: 'avatarLabels.shape.rounded' },
  { value: 'square', labelKey: 'avatarLabels.shape.square' },
];

export const AGENT_AVATAR_FACES: readonly { value: AgentAvatarFace; labelKey: string }[] = [
  { value: 'white', labelKey: 'avatarLabels.face.white' },
  { value: 'black', labelKey: 'avatarLabels.face.black' },
];

/* Avatar colours are content, not UI chrome: the palette is intentionally
   hardcoded here (same exception as the coloured file icons). */
export const AGENT_AVATAR_COLORS: readonly AgentAvatarColorSpec[] = [
  { value: 'green', labelKey: 'avatarLabels.color.green', hex: '#3BA55D' },
  { value: 'blue', labelKey: 'avatarLabels.color.blue', hex: '#5865F2' },
  { value: 'red', labelKey: 'avatarLabels.color.red', hex: '#ED4245' },
  { value: 'orange', labelKey: 'avatarLabels.color.orange', hex: '#FAA81A' },
  { value: 'purple', labelKey: 'avatarLabels.color.purple', hex: '#9B59B6' },
  { value: 'teal', labelKey: 'avatarLabels.color.teal', hex: '#1ABC9C' },
  { value: 'pink', labelKey: 'avatarLabels.color.pink', hex: '#EB459E' },
  { value: 'yellow', labelKey: 'avatarLabels.color.yellow', hex: '#FEE75C' },
  { value: 'emerald', labelKey: 'avatarLabels.color.emerald', hex: '#2ECC71' },
  { value: 'coral', labelKey: 'avatarLabels.color.coral', hex: '#FF7A5C' },
  { value: 'gray', labelKey: 'avatarLabels.color.gray', hex: '#C7CCD1' },
  { value: 'silver', labelKey: 'avatarLabels.color.silver', hex: '#F8FAFC', gradient: ['#F8FAFC', '#94A3B8'] },
];

export const AGENT_AVATAR_BODIES: readonly AgentAvatarBodySpec[] = [
  {
    value: 'mascot',
    labelKey: 'avatarLabels.body.mascot',
    paths: ['M84 16L22 50L84 84Z'],
    face: { x: 54, y: 50, scale: 0.9 },
    strokeWidth: 10,
  },
  {
    value: 'circle',
    labelKey: 'avatarLabels.shape.circle',
    paths: ['M50 8a42 42 0 1 0 0 84a42 42 0 1 0 0-84Z'],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'bubble',
    labelKey: 'avatarLabels.body.bubble',
    paths: [
      'M50 8a42 42 0 1 0 0 84a42 42 0 1 0 0-84Z',
      'M70 82l18 6-6-18Z',
    ],
    face: { x: 50, y: 48, scale: 1 },
  },
  {
    value: 'rounded',
    labelKey: 'avatarLabels.shape.rounded',
    paths: [
      'M30 8h40a22 22 0 0 1 22 22v40a22 22 0 0 1-22 22H30A22 22 0 0 1 8 70V30A22 22 0 0 1 30 8Z',
    ],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'square',
    labelKey: 'avatarLabels.shape.square',
    paths: [
      'M20 8h60a12 12 0 0 1 12 12v60a12 12 0 0 1-12 12H20A12 12 0 0 1 8 80V20A12 12 0 0 1 20 8Z',
    ],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'drop',
    labelKey: 'avatarLabels.body.drop',
    paths: ['M50 6c13 15 28 29 28 46a28 28 0 0 1-56 0C22 35 37 21 50 6Z'],
    face: { x: 50, y: 56, scale: 0.9 },
  },
  {
    value: 'blob',
    labelKey: 'avatarLabels.body.blob',
    paths: [
      'M50 6c21-2 41 13 42 34 1 21-12 41-33 48-21 7-42-4-47-25C7 42 18 22 38 12c4-2 8-5 12-6Z',
    ],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'hex',
    labelKey: 'avatarLabels.body.hex',
    paths: ['M50 6l38 22v44l-38 22-38-22V28L50 6Z'],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'diamond',
    labelKey: 'avatarLabels.body.diamond',
    paths: ['M50 6l44 44-44 44L6 50 50 6Z'],
    face: { x: 50, y: 50, scale: 0.82 },
  },
  {
    value: 'star',
    labelKey: 'avatarLabels.body.star',
    paths: ['M50 4l12 30 32 2-25 21 9 33-28-18-28 18 9-33-25-21 32-2L50 4Z'],
    face: { x: 50, y: 52, scale: 0.6 },
  },
];

export const AGENT_AVATAR_EXPRESSIONS: readonly AgentAvatarExpressionSpec[] = [
  { value: 'neutral', labelKey: 'avatarLabels.expression.neutral', eyes: 'oval', mouth: 'smile' },
  { value: 'happy', labelKey: 'avatarLabels.expression.happy', eyes: 'arc', mouth: 'smile' },
  { value: 'grin', labelKey: 'avatarLabels.expression.grin', eyes: 'oval', mouth: 'grin' },
  { value: 'wink', labelKey: 'avatarLabels.expression.wink', eyes: 'wink', mouth: 'smirk' },
  { value: 'surprised', labelKey: 'avatarLabels.expression.surprised', eyes: 'wide', mouth: 'small' },
  { value: 'angry', labelKey: 'avatarLabels.expression.angry', eyes: 'angry', mouth: 'frown' },
  { value: 'sad', labelKey: 'avatarLabels.expression.sad', eyes: 'oval', mouth: 'frown' },
  { value: 'sleepy', labelKey: 'avatarLabels.expression.sleepy', eyes: 'line', mouth: 'flat' },
  { value: 'smug', labelKey: 'avatarLabels.expression.smug', eyes: 'half', mouth: 'smirk' },
  { value: 'dizzy', labelKey: 'avatarLabels.expression.dizzy', eyes: 'x', mouth: 'wavy' },
];

export const DEFAULT_AGENT_AVATAR: AgentAvatar = {
  kind: 'mascot',
  shape: 'mascot',
  body: 'mascot',
  expression: 'neutral',
  color: 'blue',
  face: 'white',
};

export const AGENT_AVATAR_BODY_BY_ID = new Map(
  AGENT_AVATAR_BODIES.map((body) => [body.value, body] as const),
);
export const AGENT_AVATAR_EXPRESSION_BY_ID = new Map(
  AGENT_AVATAR_EXPRESSIONS.map((expression) => [expression.value, expression] as const),
);
export const AGENT_AVATAR_COLOR_BY_ID = new Map(
  AGENT_AVATAR_COLORS.map((color) => [color.value, color] as const),
);

export function agentAvatarForEmoji(value: string): AgentAvatar {
  return { kind: 'emoji', shape: 'rounded', value: value.trim() || '🤖' };
}

export function isMascotAvatar(
  avatar: AgentAvatar,
): avatar is AgentAvatar & { kind: 'mascot' } {
  return avatar.kind === 'mascot';
}

export function mascotVariant(
  avatar: AgentAvatar,
  patch: Partial<Pick<AgentAvatar & { kind: 'mascot' }, 'body' | 'expression' | 'color' | 'face'>>,
): AgentAvatar {
  return isMascotAvatar(avatar) ? { ...avatar, ...patch } : avatar;
}

