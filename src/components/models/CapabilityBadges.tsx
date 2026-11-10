import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@/components/ui';
import { t } from '@/lib/i18n';
import { modalityLabel } from '@/lib/modelMenu';
import type { ModelInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface Capability {
  id: string;
  label: string;
  tone: BadgeTone;
  title: string;
}

/** Capability list derived from the catalog entry (single source of truth). */
export function capabilitiesOf(model: ModelInfo): Capability[] {
  const capabilities: Capability[] = [];
  if (model.status === 'free') {
    capabilities.push({
      id: 'free',
      label: t('models:capabilities.free'),
      tone: 'success',
      title: t('models:capabilities.freeTitle'),
    });
  }
  if (model.attachment || model.modalities.input.includes('image')) {
    const modalities =
      model.modalities.input
        .filter((entry) => entry !== 'text')
        .map((entry) => modalityLabel(entry))
        .join(', ') || t('models:capabilities.attachments');
    capabilities.push({
      id: 'vision',
      label: t('models:capabilities.vision'),
      tone: 'accent',
      title: t('models:capabilities.visionTitle', { modalities }),
    });
  }
  if (model.reasoningOptions.length) {
    capabilities.push({
      id: 'reasoning',
      label: t('models:capabilities.reasoning'),
      tone: 'accent',
      title: t('models:capabilities.reasoningTitle'),
    });
  }
  if (model.openWeights) {
    capabilities.push({
      id: 'open',
      label: t('models:capabilities.open'),
      tone: 'neutral',
      title: t('models:capabilities.openTitle'),
    });
  }
  if (model.status === 'beta') {
    capabilities.push({
      id: 'preview',
      label: t('models:capabilities.preview'),
      tone: 'warning',
      title: t('models:capabilities.previewTitle'),
    });
  }
  if (model.status === 'unavailable') {
    capabilities.push({
      id: 'unavailable',
      label: t('models:capabilities.unavailable'),
      tone: 'danger',
      title: t('models:capabilities.unavailableTitle'),
    });
  }
  return capabilities;
}

export interface CapabilityBadgesProps {
  model: ModelInfo;
  max?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/** Reusable capability chips for pickers, detail panels and message footers. */
export function CapabilityBadges({ model, max = 4, size = 'sm', className }: CapabilityBadgesProps) {
  useTranslation('models');
  const capabilities = capabilitiesOf(model).slice(0, max);
  if (!capabilities.length) return null;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {capabilities.map((capability) => (
        <Badge
          key={capability.id}
          tone={capability.tone}
          size={size}
          title={capability.title}
        >
          {capability.label}
        </Badge>
      ))}
    </span>
  );
}
