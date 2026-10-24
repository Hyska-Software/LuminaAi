import { Sparkles } from 'lucide-react';

/** Minimal boot screen shown while settings/catalog/conversations load. */
export function SplashScreen() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-background">
      <div className="relative">
        <div className="absolute inset-0 animate-pulse-soft rounded-[28%] bg-accent/25 blur-2xl" />
        <div className="relative flex size-16 items-center justify-center rounded-[28%] bg-gradient-to-br from-accent to-[#3ad0ff] text-white shadow-xl">
          <Sparkles className="size-8" strokeWidth={2} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-lg font-semibold tracking-tight">Lumina</span>
        <span className="text-[13px] text-foreground-muted">Preparando seu espaço…</span>
      </div>
      <div className="h-1 w-36 overflow-hidden rounded-full bg-surface-active">
        <div className="h-full w-1/3 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-accent" />
      </div>
    </div>
  );
}
