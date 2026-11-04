import { AgentMascot } from './AgentMascot';
import { DEFAULT_AGENT_AVATAR } from '@/lib/agentAvatar';
import type { AgentAvatar as AgentAvatarSpec, AgentAvatarShape } from '@/lib/types';
import { cn } from '@/lib/utils';

export type AgentAvatarSize = 'sm' | 'md' | 'lg' | 'xl' | 'tile';

const BOX: Record<AgentAvatarSize, string> = {
  sm: 'size-7 text-[15px]',
  md: 'size-9 text-[20px]',
  lg: 'size-14 text-[30px]',
  xl: 'size-24 text-[44px]',
  tile: 'size-12 text-[26px]',
};

const FRAME_RADIUS: Record<Exclude<AgentAvatarShape, 'mascot'>, string> = {
  circle: 'rounded-full',
  rounded: 'rounded-xl',
  square: 'rounded-md',
};

function safeAvatar(avatar: AgentAvatarSpec): AgentAvatarSpec {
  if (avatar.kind === 'mascot' || avatar.kind === 'image' || avatar.kind === 'emoji') {
    return avatar;
  }
  return DEFAULT_AGENT_AVATAR;
}

/** Renders the agent identity in a frame. Decorative: callers own the label. */
export function AgentAvatar({
  avatar: rawAvatar,
  size = 'md',
  className,
}: {
  avatar: AgentAvatarSpec;
  size?: AgentAvatarSize;
  className?: string;
}) {
  const avatar = safeAvatar(rawAvatar);
  const framed = avatar.shape !== 'mascot';
  const frame =
    avatar.shape === 'mascot'
      ? 'bg-transparent'
      : cn('border border-border bg-surface-active/70', FRAME_RADIUS[avatar.shape]);

  return (
    <span
      aria-hidden
      data-avatar-kind={avatar.kind}
      data-avatar-shape={avatar.shape}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden',
        BOX[size],
        frame,
        className,
      )}
    >
      {avatar.kind === 'mascot' ? (
        <span
          className={
            framed ? 'flex size-full items-center justify-center p-[10%]' : 'size-full'
          }
        >
          <AgentMascot avatar={avatar} className="size-full" />
        </span>
      ) : avatar.kind === 'image' ? (
        <img
          src={avatar.dataUrl}
          alt=""
          draggable={false}
          className={cn('size-full', framed ? 'object-cover' : 'object-contain')}
        />
      ) : (
        <span className="leading-none">{avatar.value}</span>
      )}
    </span>
  );
}
