import { Bot, Code, MessageSquare, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useReduceMotion } from './hooks';

interface LayoutModeOption {
  value: 'chat' | 'code' | 'agent';
  label: string;
  title: string;
  icon: LucideIcon;
}

const MODES: readonly LayoutModeOption[] = [
  { value: 'chat', label: 'Chat', title: 'Layout de conversa', icon: MessageSquare },
  { value: 'code', label: 'Code', title: 'Layout de código', icon: Code },
  { value: 'agent', label: 'Agentes', title: 'Layout de agentes', icon: Bot },
];

/**
 * Chat | Code segmented control shown centered in the title bar
 * (docs/goals/chat-code-layout/PLAN.md §3.1). It is the only entry point to the
 * Code workbench, so it stays visible in both layouts and its choice is
 * persisted with the rest of the UI state.
 */
export function LayoutModeSwitch({ className }: { className?: string }) {
  const layoutMode = useUiStore((state) => state.layoutMode);
  const setLayoutMode = useUiStore((state) => state.setLayoutMode);
  const reduceMotion = useReduceMotion();

  return (
    <div
      role="group"
      aria-label="Modo do aplicativo"
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-hover p-0.5',
        className,
      )}
    >
      {MODES.map(({ value, label, title, icon: Icon }) => {
        const active = layoutMode === value;
        return (
          <button
            key={value}
            type="button"
            title={title}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setLayoutMode(value)}
            className={cn(
              'relative flex h-8 w-12 items-center justify-center rounded-full',
              'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              active ? 'text-foreground' : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId="layout-mode-active"
                aria-hidden
                className="absolute inset-0 rounded-full bg-surface-raised shadow-sm dark:bg-surface-active"
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
            <Icon aria-hidden className="relative size-4" />
          </button>
        );
      })}
    </div>
  );
}
