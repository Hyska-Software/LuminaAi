import { useTranslation } from 'react-i18next';

import { useReduceMotion } from '@/components/layout/hooks';
import { cn } from '@/lib/utils';

export interface AgentActivityDotsProps {
  label?: string;
  className?: string;
}

/** Three-dot working mark shared by the sidebar rows and the thread header. */
export function AgentActivityDots({
  label,
  className,
}: AgentActivityDotsProps) {
  const { t } = useTranslation('agents');
  const reduceMotion = useReduceMotion();
  return (
    <span
      role="status"
      aria-label={label ?? t('activity.responding')}
      data-motion={reduceMotion ? 'reduced' : 'animated'}
      className={cn('inline-flex shrink-0 items-center gap-0.5', className)}
    >
      <span aria-hidden className="agent-activity-dots">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="agent-activity-dot"
            style={reduceMotion ? undefined : { animationDelay: `${index * 120}ms` }}
          />
        ))}
      </span>
    </span>
  );
}
