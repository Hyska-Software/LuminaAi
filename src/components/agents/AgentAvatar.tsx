import { cn } from '@/lib/utils';

export function AgentAvatar({
  emoji,
  size = 'md',
  className,
}: {
  emoji: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-7 text-[15px]' : size === 'lg' ? 'size-14 text-[30px]' : 'size-9 text-[20px]';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl border border-border bg-surface-active/70',
        box,
        className,
      )}
    >
      {emoji || '🤖'}
    </span>
  );
}
