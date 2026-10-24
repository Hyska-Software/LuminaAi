import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{description}</p>
        ) : null}
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised px-4">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  label,
  description,
  children,
  vertical = false,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  vertical?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-6 py-3',
        vertical ? 'flex-col items-stretch' : 'flex-wrap items-center justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug text-foreground">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className={cn('shrink-0', vertical ? 'w-full' : 'max-w-[340px]')}>{children}</div>
      ) : null}
    </div>
  );
}

/** Free-form block inside a SettingsSection (already separated by dividers). */
export function SettingsBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('py-3', className)}>{children}</div>;
}
