import { BrandMark } from '@/components/chat/BrandMark';

/** Minimal boot screen shown while settings/catalog/conversations load. */
export function SplashScreen() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-background">
      <div className="relative inline-flex items-center justify-center">
        <div className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 animate-pulse-soft rounded-full bg-accent/25 blur-2xl" />
        <BrandMark size={72} className="relative" />
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
