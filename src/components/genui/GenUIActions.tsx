import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { propObjectArray, propString, type GenUIValue } from '@/lib/genui';
import { runGenUIAction } from '@/lib/genui/actions';
import { Button } from '@/components/ui';
import { genUIIcon } from './icons';

export interface GenUIActionsProps {
  props?: Record<string, GenUIValue>;
}

const TONES = ['primary', 'secondary', 'ghost'] as const;
type ActionTone = (typeof TONES)[number];

interface GenUIActionItem {
  label: string;
  kind: 'prompt' | 'copy';
  text: string;
  tone: ActionTone;
  icon: string;
}

/** Lê e valida os itens de `actions`; itens sem rótulo ou sem prompt/copy são descartados. */
function readItems(props: Record<string, GenUIValue> | undefined): GenUIActionItem[] {
  const items: GenUIActionItem[] = [];
  let hasPrimary = false;

  for (const raw of propObjectArray(props, 'items')) {
    const label = propString(raw, 'label').trim();
    const prompt = propString(raw, 'prompt').trim();
    const copy = propString(raw, 'copy').trim();
    if (!label) continue;
    const kind: GenUIActionItem['kind'] | null = prompt ? 'prompt' : copy ? 'copy' : null;
    if (!kind) continue;

    const toneRaw = propString(raw, 'tone', 'secondary');
    let tone: ActionTone = (TONES as readonly string[]).includes(toneRaw)
      ? (toneRaw as ActionTone)
      : 'secondary';
    // O contrato permite no máximo uma primária; o linter avisa, mas o renderer
    // nunca deve quebrar nem exibir duas ações primárias.
    if (tone === 'primary') {
      if (hasPrimary) tone = 'secondary';
      else hasPrimary = true;
    }

    items.push({ label, kind, text: kind === 'prompt' ? prompt : copy, tone, icon: propString(raw, 'icon') });
  }
  return items;
}

/**
 * Linha de ações sugeridas (1–4 botões).
 *
 * `prompt` apenas preenche o composer via evento global `zylara:suggest` —
 * nunca envia a mensagem. `copy` copia o texto e confirma com um toast.
 */
export function GenUIActions({ props }: GenUIActionsProps) {
  const { t } = useTranslation('genui');
  const items = readItems(props);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const align = propString(props, 'align', 'start') === 'end' ? 'end' : 'start';

  if (!items.length) return null;

  const run = async (item: GenUIActionItem, index: number) => {
    setBusyIndex(index);
    try {
      const result = await runGenUIAction(
        item.kind === 'prompt'
          ? { label: item.label, prompt: item.text }
          : { label: item.label, copy: item.text },
      );
      if (!result.ok) {
        toast.error(result.message ?? t('actions.errors.run'));
        return;
      }
      if (item.kind === 'copy') toast.success(t('actions.copied'));
    } finally {
      setBusyIndex(null);
    }
  };

  return (
    <div
      role="group"
      aria-label={t('actions.group')}
      className={cn('flex flex-wrap items-center gap-2', align === 'end' ? 'justify-end' : 'justify-start')}
    >
      {items.map((item, index) => {
        const iconName = item.icon || (item.kind === 'copy' ? 'copy' : '');
        const Icon = genUIIcon(iconName);
        return (
          <Button
            key={`${item.label}-${index}`}
            size="sm"
            variant={item.tone}
            loading={busyIndex === index}
            disabled={busyIndex !== null && busyIndex !== index}
            leftIcon={Icon ? <Icon aria-hidden className="size-4" /> : undefined}
            onClick={() => void run(item, index)}
            className="max-w-full"
            title={item.label}
          >
            <span className="truncate">{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
