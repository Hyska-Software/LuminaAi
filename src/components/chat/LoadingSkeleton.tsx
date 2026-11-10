import { useTranslation } from 'react-i18next';

/** Placeholder shown while a conversation is being loaded. */
export function LoadingSkeleton() {
  const { t } = useTranslation('chat');
  return (
    <div
      className="mx-auto w-full max-w-3xl px-6 py-8"
      role="status"
      aria-label={t('loading.aria')}
    >
      <div className="flex flex-col gap-7">
        <div className="flex justify-end">
          <div className="h-14 w-2/5 animate-pulse rounded-3xl bg-surface-hover motion-reduce:animate-none" />
        </div>

        <div className="flex items-start gap-3">
          <div className="size-6 shrink-0 animate-pulse rounded-full bg-surface-hover motion-reduce:animate-none" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="h-3.5 w-11/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <div className="h-3.5 w-10/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <div className="h-3.5 w-7/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
          </div>
        </div>

        <div className="flex justify-end">
          <div className="h-10 w-1/3 animate-pulse rounded-3xl bg-surface-hover motion-reduce:animate-none" />
        </div>

        <div className="flex items-start gap-3">
          <div className="size-6 shrink-0 animate-pulse rounded-full bg-surface-hover motion-reduce:animate-none" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="h-3.5 w-10/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <div className="h-3.5 w-9/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
          </div>
        </div>
      </div>

      <span className="sr-only">{t('loading.text')}</span>
    </div>
  );
}
