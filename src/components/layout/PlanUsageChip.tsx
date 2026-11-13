/**
 * Compact "Plano ChatGPT" chip shown in the title bar when the active provider
 * is signed in with a ChatGPT plan (T4.4a). It used to live in the composer;
 * the title bar is the global surface for account-level indicators.
 *
 * It is a passive indicator: it never renders quota numbers (the API does not
 * expose them) and its affordance links straight to the ChatGPT usage
 * dashboard. "Gerenciar uso" always opens externally.
 */
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { providerSupportsPlan } from '@/lib/catalog';
import { useAppStore } from '@/lib/store';
import { openExternalUrl } from '@/components/chat/external';
import { planUsageUrl } from '@/components/chat/turnError';

export function PlanUsageChip() {
  const { t } = useTranslation('common');
  const provider = useAppStore((state) =>
    state.providers.find((entry) => entry.id === state.selection.providerId),
  );
  const auth = useAppStore((state) => state.authStatus(state.selection.providerId));

  const usingPlan = auth?.state === 'signed-in' && auth.planUsage;
  if (!providerSupportsPlan(provider) || !usingPlan) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full bg-surface-hover py-0.5 pl-2 pr-0.5 text-[11px] leading-none"
      title={t('shell.plan.tooltip')}
    >
      <Sparkles aria-hidden className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
      <span className="font-medium text-foreground-muted">{t('shell.plan.title')}</span>
      <button
        type="button"
        onClick={() => void openExternalUrl(planUsageUrl(provider))}
        aria-label={t('shell.plan.manageAria')}
        className="rounded-full px-1.5 py-1 font-medium text-accent underline-offset-2 transition-colors duration-150 hover:bg-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t('shell.plan.manage')}
      </button>
    </div>
  );
}
