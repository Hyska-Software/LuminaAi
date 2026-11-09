import { useState } from 'react';
import { motion } from 'motion/react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui';
import { LAYOUT_MODES } from '@/lib/layoutModes';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useReduceMotion } from './hooks';

/**
 * Chat | Code | Agentes segmented control shown centered in the title bar
 * (docs/goals/chat-code-layout/PLAN.md §3.1). It is the only entry point to the
 * Code workbench, so it stays visible for every enabled layout and its choice is
 * persisted with the rest of the UI state. Right-clicking the pill opens the
 * visibility menu; when only one layout is enabled the control disappears.
 */
export function LayoutModeSwitch({ className }: { className?: string }) {
  const layoutMode = useUiStore((state) => state.layoutMode);
  const enabledLayouts = useUiStore((state) => state.enabledLayouts);
  const setLayoutMode = useUiStore((state) => state.setLayoutMode);
  const setLayoutEnabled = useUiStore((state) => state.setLayoutEnabled);
  const reduceMotion = useReduceMotion();
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);

  const visibleModes = LAYOUT_MODES.filter((mode) => enabledLayouts[mode.value]);
  // With a single visible layout there is nothing to switch: hide the control
  // entirely (the layout is still chosen from Settings).
  if (visibleModes.length <= 1) return null;

  return (
    <DropdownMenu
      open={menuPoint !== null}
      onOpenChange={(open) => {
        if (!open) setMenuPoint(null);
      }}
    >
      <div
        role="group"
        aria-label="Modo do aplicativo"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPoint({ x: event.clientX, y: event.clientY });
        }}
        className={cn(
          'relative inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-hover p-0.5',
          className,
        )}
      >
        {visibleModes.map(({ value, label, title, icon: Icon }) => {
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
        {/* Invisible 1px anchor at the pointer: Radix positions the menu there.
            Its text names the menu through the trigger's aria-labelledby. */}
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-px overflow-hidden opacity-0"
            style={{ left: menuPoint?.x ?? 0, top: menuPoint?.y ?? 0 }}
          >
            Layouts
          </span>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={4}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel>Layouts</DropdownMenuLabel>
        {LAYOUT_MODES.map(({ value, label }) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={enabledLayouts[value]}
            onCheckedChange={(checked) => setLayoutEnabled(value, checked === true)}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
