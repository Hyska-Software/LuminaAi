import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';

import { AgentAvatar } from './AgentAvatar';
import { Button, SegmentedControl } from '@/components/ui';
import { api } from '@/lib/api';
import {
  AGENT_AVATAR_BODIES,
  AGENT_AVATAR_COLORS,
  AGENT_AVATAR_EXPRESSIONS,
  AGENT_AVATAR_FACES,
  AGENT_AVATAR_SHAPES,
  DEFAULT_AGENT_AVATAR,
  isMascotAvatar,
  mascotVariant,
} from '@/lib/agentAvatar';
import type {
  AgentAvatar as AgentAvatarSpec,
  AgentAvatarFace,
  AgentAvatarShape,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AgentAvatarPickerProps {
  value: AgentAvatarSpec;
  onChange: (avatar: AgentAvatarSpec) => void;
  disabled?: boolean;
  className?: string;
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle';

function tileClass(selected: boolean): string {
  return cn(
    'flex aspect-square items-center justify-center rounded-xl border p-1 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
    selected
      ? 'border-accent bg-accent-soft/40 ring-2 ring-accent/30'
      : 'border-border bg-surface/50 hover:border-border-strong hover:bg-surface-hover',
  );
}

/** Controlled avatar customizer shared by the quick dialog and the editor tab. */
export function AgentAvatarPicker({
  value,
  onChange,
  disabled = false,
  className,
}: AgentAvatarPickerProps) {
  const [uploading, setUploading] = useState(false);
  const mascot = isMascotAvatar(value) ? value : null;

  const pickImage = async () => {
    if (disabled || uploading) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Imagem', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    setUploading(true);
    try {
      const dataUrl = await api.importAgentAvatarImage(selected);
      onChange({
        kind: 'image',
        dataUrl,
        shape: value.shape === 'mascot' ? 'circle' : value.shape,
      });
    } catch (error) {
      toast.error('Não foi possível usar a imagem', { description: String(error) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn('space-y-5', className)}>
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange(DEFAULT_AGENT_AVATAR)}
        >
          Redefinir mascote
        </Button>
      </div>

      <div className="flex justify-center py-1">
        <AgentAvatar avatar={value} size="xl" />
      </div>

      <Button
        variant="secondary"
        className="w-full"
        loading={uploading}
        disabled={disabled}
        onClick={() => void pickImage()}
        leftIcon={<ImagePlus className="size-4" />}
      >
        Enviar imagem
      </Button>
      <p className="-mt-3 text-center text-[11px] text-foreground-subtle">
        PNG, JPEG, GIF ou WebP · até 10 MB
      </p>

      <section className="space-y-2">
        <p className={LABEL}>Formato</p>
        <SegmentedControl
          options={[...AGENT_AVATAR_SHAPES]}
          value={value.shape}
          onChange={(shape) =>
            onChange({ ...value, shape: shape as AgentAvatarShape } as AgentAvatarSpec)
          }
          ariaLabel="Formato do avatar"
          size="sm"
          fullWidth
          disabled={disabled}
          className="[&>button]:px-1"
        />
      </section>

      {mascot ? (
        <>
          <section className="space-y-2">
            <p className={LABEL}>Cor dos olhos</p>
            <SegmentedControl
              options={[...AGENT_AVATAR_FACES]}
              value={mascot.face}
              onChange={(face) =>
                onChange(mascotVariant(mascot, { face: face as AgentAvatarFace }))
              }
              ariaLabel="Cor dos olhos"
              size="sm"
              fullWidth
              disabled={disabled}
            />
          </section>

          <section className="space-y-2">
            <p className={LABEL}>Expressão</p>
            <div role="group" aria-label="Expressão" className="grid grid-cols-5 gap-2">
              {AGENT_AVATAR_EXPRESSIONS.map((spec) => {
                const selected = mascot.expression === spec.value;
                const variant = mascotVariant(mascot, { expression: spec.value });
                return (
                  <button
                    key={spec.value}
                    type="button"
                    aria-label={`Expressão ${spec.label}`}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onChange(variant)}
                    className={tileClass(selected)}
                  >
                    <AgentAvatar avatar={variant} size="tile" />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <p className={LABEL}>Cor</p>
            <div role="group" aria-label="Cor" className="grid grid-cols-6 gap-2">
              {AGENT_AVATAR_COLORS.map((spec) => {
                const selected = mascot.color === spec.value;
                return (
                  <button
                    key={spec.value}
                    type="button"
                    aria-label={`Cor ${spec.label}`}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onChange(mascotVariant(mascot, { color: spec.value }))}
                    className={cn(
                      'size-8 rounded-full border border-border transition-transform',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      selected
                        ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised'
                        : 'hover:scale-105',
                    )}
                    style={{
                      background: spec.gradient
                        ? `linear-gradient(135deg, ${spec.gradient[0]}, ${spec.gradient[1]})`
                        : spec.hex,
                    }}
                  />
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <p className={LABEL}>Corpo</p>
            <div role="group" aria-label="Corpo" className="grid grid-cols-5 gap-2">
              {AGENT_AVATAR_BODIES.map((spec) => {
                const selected = mascot.body === spec.value;
                const variant = mascotVariant(mascot, { body: spec.value });
                return (
                  <button
                    key={spec.value}
                    type="button"
                    aria-label={`Corpo ${spec.label}`}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onChange(variant)}
                    className={tileClass(selected)}
                  >
                    <AgentAvatar avatar={variant} size="tile" />
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
