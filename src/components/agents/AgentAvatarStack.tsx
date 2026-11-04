import { AgentAvatar } from './AgentAvatar';
import type { AgentAvatar as AgentAvatarSpec } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Minimal agent identity needed by an avatar stack. */
export interface AgentAvatarStackMember {
  id: string;
  name: string;
  avatar: AgentAvatarSpec;
}

/**
 * Overlapping agent thumbnails with a `+N` overflow chip.
 *
 * `ringClassName` separates overlapping avatars from the surface behind them;
 * it is skipped for mascot silhouettes, whose transparent box corners would
 * otherwise draw a square outline instead of following the character.
 */
export function AgentAvatarStack({
  members,
  size = 'xs',
  max = 2,
  className,
  avatarClassName,
  ringClassName,
  overflowClassName,
}: {
  members: AgentAvatarStackMember[];
  size?: 'xs' | 'sm';
  max?: number;
  className?: string;
  avatarClassName?: string;
  ringClassName?: string;
  overflowClassName?: string;
}) {
  if (members.length === 0) return null;
  const visible = members.slice(0, Math.max(1, max));
  const overflow = members.length - visible.length;
  const chip = size === 'sm' ? 'size-6 text-[10px]' : 'size-5 text-[9px]';
  const overlap = size === 'sm' ? '-space-x-1.5' : '-space-x-1';
  return (
    <span
      aria-hidden
      title={members.map((member) => member.name).join(', ')}
      className={cn('flex shrink-0 items-center', overlap, className)}
    >
      {visible.map((member) => {
        const framed = member.avatar.shape !== 'mascot';
        return (
          <AgentAvatar
            key={member.id}
            avatar={member.avatar}
            size={size}
            className={cn('relative', framed && ringClassName, avatarClassName)}
          />
        );
      })}
      {overflow > 0 ? (
        <span
          className={cn(
            'relative flex items-center justify-center rounded-full bg-surface-active',
            'font-medium tabular-nums text-foreground-muted',
            chip,
            ringClassName,
            overflowClassName,
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
