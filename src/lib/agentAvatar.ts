import type {
  AgentAvatar,
  AgentAvatarBody,
  AgentAvatarColor,
  AgentAvatarExpression,
  AgentAvatarShape,
} from './types';

export interface AgentAvatarBodySpec {
  value: AgentAvatarBody;
  label: string;
  paths: readonly string[];
  face: { x: number; y: number; scale: number };
  strokeWidth?: number;
}

export interface AgentAvatarExpressionSpec {
  value: AgentAvatarExpression;
  label: string;
  eyes: 'oval' | 'wide' | 'arc' | 'wink' | 'angry' | 'line' | 'half' | 'x';
  mouth: 'smile' | 'grin' | 'open' | 'flat' | 'frown' | 'smirk' | 'wavy' | 'small';
}

export interface AgentAvatarColorSpec {
  value: AgentAvatarColor;
  label: string;
  hex: string;
  gradient?: readonly [string, string];
}

export const AGENT_AVATAR_SHAPES: readonly { value: AgentAvatarShape; label: string }[] = [
  { value: 'mascot', label: 'Mascote' },
  { value: 'circle', label: 'Círculo' },
  { value: 'rounded', label: 'Arredondado' },
  { value: 'square', label: 'Quadrado' },
];

/* Avatar colours are content, not UI chrome: the palette is intentionally
   hardcoded here (same exception as the coloured file icons). */
export const AGENT_AVATAR_COLORS: readonly AgentAvatarColorSpec[] = [
  { value: 'green', label: 'Verde', hex: '#3BA55D' },
  { value: 'blue', label: 'Azul', hex: '#5865F2' },
  { value: 'red', label: 'Vermelho', hex: '#ED4245' },
  { value: 'orange', label: 'Laranja', hex: '#FAA81A' },
  { value: 'purple', label: 'Roxo', hex: '#9B59B6' },
  { value: 'teal', label: 'Turquesa', hex: '#1ABC9C' },
  { value: 'pink', label: 'Rosa', hex: '#EB459E' },
  { value: 'yellow', label: 'Amarelo', hex: '#FEE75C' },
  { value: 'emerald', label: 'Esmeralda', hex: '#2ECC71' },
  { value: 'coral', label: 'Coral', hex: '#FF7A5C' },
  { value: 'gray', label: 'Cinza', hex: '#C7CCD1' },
  { value: 'silver', label: 'Prata', hex: '#F8FAFC', gradient: ['#F8FAFC', '#94A3B8'] },
];

export const AGENT_AVATAR_BODIES: readonly AgentAvatarBodySpec[] = [
  {
    value: 'mascot',
    label: 'Mascote',
    paths: ['M84 16L22 50L84 84Z'],
    face: { x: 54, y: 50, scale: 0.9 },
    strokeWidth: 10,
  },
  {
    value: 'circle',
    label: 'Círculo',
    paths: ['M50 8a42 42 0 1 0 0 84a42 42 0 1 0 0-84Z'],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'bubble',
    label: 'Bolha',
    paths: [
      'M50 8a42 42 0 1 0 0 84a42 42 0 1 0 0-84Z',
      'M70 82l18 6-6-18Z',
    ],
    face: { x: 50, y: 48, scale: 1 },
  },
  {
    value: 'rounded',
    label: 'Arredondado',
    paths: [
      'M30 8h40a22 22 0 0 1 22 22v40a22 22 0 0 1-22 22H30A22 22 0 0 1 8 70V30A22 22 0 0 1 30 8Z',
    ],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'square',
    label: 'Quadrado',
    paths: [
      'M20 8h60a12 12 0 0 1 12 12v60a12 12 0 0 1-12 12H20A12 12 0 0 1 8 80V20A12 12 0 0 1 20 8Z',
    ],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'drop',
    label: 'Gota',
    paths: ['M50 6c13 15 28 29 28 46a28 28 0 0 1-56 0C22 35 37 21 50 6Z'],
    face: { x: 50, y: 56, scale: 0.9 },
  },
  {
    value: 'blob',
    label: 'Blob',
    paths: [
      'M50 6c21-2 41 13 42 34 1 21-12 41-33 48-21 7-42-4-47-25C7 42 18 22 38 12c4-2 8-5 12-6Z',
    ],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'hex',
    label: 'Hexágono',
    paths: ['M50 6l38 22v44l-38 22-38-22V28L50 6Z'],
    face: { x: 50, y: 50, scale: 1 },
  },
  {
    value: 'diamond',
    label: 'Diamante',
    paths: ['M50 6l44 44-44 44L6 50 50 6Z'],
    face: { x: 50, y: 50, scale: 0.82 },
  },
  {
    value: 'star',
    label: 'Estrela',
    paths: ['M50 4l12 30 32 2-25 21 9 33-28-18-28 18 9-33-25-21 32-2L50 4Z'],
    face: { x: 50, y: 52, scale: 0.6 },
  },
];

export const AGENT_AVATAR_EXPRESSIONS: readonly AgentAvatarExpressionSpec[] = [
  { value: 'neutral', label: 'Neutro', eyes: 'oval', mouth: 'smile' },
  { value: 'happy', label: 'Feliz', eyes: 'arc', mouth: 'smile' },
  { value: 'grin', label: 'Sorriso', eyes: 'oval', mouth: 'grin' },
  { value: 'wink', label: 'Piscada', eyes: 'wink', mouth: 'smirk' },
  { value: 'surprised', label: 'Surpreso', eyes: 'wide', mouth: 'small' },
  { value: 'angry', label: 'Bravo', eyes: 'angry', mouth: 'frown' },
  { value: 'sad', label: 'Triste', eyes: 'oval', mouth: 'frown' },
  { value: 'sleepy', label: 'Sonolento', eyes: 'line', mouth: 'flat' },
  { value: 'smug', label: 'Convencido', eyes: 'half', mouth: 'smirk' },
  { value: 'dizzy', label: 'Tonto', eyes: 'x', mouth: 'wavy' },
];

export const DEFAULT_AGENT_AVATAR: AgentAvatar = {
  kind: 'mascot',
  shape: 'mascot',
  body: 'mascot',
  expression: 'neutral',
  color: 'blue',
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
  patch: Partial<Pick<AgentAvatar & { kind: 'mascot' }, 'body' | 'expression' | 'color'>>,
): AgentAvatar {
  return isMascotAvatar(avatar) ? { ...avatar, ...patch } : avatar;
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Single feature colour (eyes and mouth) with enough contrast against the
 * body. Dark bodies get white features; light bodies get near-black features.
 * This intentionally does not follow the app theme: the avatar body colour is
 * the background that matters.
 */
export function featuresColorFor(color: AgentAvatarColor): string {
  const spec = AGENT_AVATAR_COLOR_BY_ID.get(color) ?? AGENT_AVATAR_COLOR_BY_ID.get('blue')!;
  const hex = spec.hex.replace('#', '');
  const red = linearChannel(Number.parseInt(hex.slice(0, 2), 16));
  const green = linearChannel(Number.parseInt(hex.slice(2, 4), 16));
  const blue = linearChannel(Number.parseInt(hex.slice(4, 6), 16));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.45 ? '#111114' : '#FFFFFF';
}
