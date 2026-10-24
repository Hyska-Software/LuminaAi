import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolsToggleProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onToggle: () => void;
  className?: string;
}

/** On/off tool pill used in the composer toolbar (DESIGN §7). */
export function ToolsToggle({ icon: Icon, label, active, onToggle, className }: ToolsToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[12.5px] font-medium',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'border-accent/30 bg-accent-soft text-accent hover:bg-accent-soft/80'
          : 'border-border bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        className,
      )}
    >
      <Icon className="size-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
