import { Badge, type BadgeTone } from '@/components/ui';
import type { ModelInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface Capability {
  label: string;
  tone: BadgeTone;
  title: string;
}

/** Capability list derived from the catalog entry (single source of truth). */
export function capabilitiesOf(model: ModelInfo): Capability[] {
  const capabilities: Capability[] = [];
  if (model.status === 'free') {
    capabilities.push({ label: 'Grátis', tone: 'success', title: 'Modelo gratuito no gateway' });
  }
  if (model.attachment || model.modalities.input.includes('image')) {
    capabilities.push({
      label: 'Visão',
      tone: 'accent',
      title: `Aceita ${model.modalities.input.filter((entry) => entry !== 'text').join(', ') || 'anexos'}`,
    });
  }
  if (model.reasoningOptions.length) {
    capabilities.push({
      label: 'Raciocínio',
      tone: 'accent',
      title: 'Expõe controle de modo de pensamento',
    });
  }
  if (model.openWeights) {
    capabilities.push({ label: 'Open', tone: 'neutral', title: 'Pesos abertos' });
  }
  if (model.status === 'beta') {
    capabilities.push({ label: 'Preview', tone: 'warning', title: 'Modelo em prévia' });
  }
  if (model.status === 'unavailable') {
    capabilities.push({
      label: 'Indisponível',
      tone: 'danger',
      title: 'Este modelo não está disponível no gateway',
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
  const capabilities = capabilitiesOf(model).slice(0, max);
  if (!capabilities.length) return null;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {capabilities.map((capability) => (
        <Badge
          key={capability.label}
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
