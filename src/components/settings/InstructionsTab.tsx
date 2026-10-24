import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Textarea } from '@/components/ui';
import { SettingsBlock, SettingsSection } from './shared';

type SaveStatus = 'idle' | 'saving' | 'saved';

const MAX_LENGTH = 8000;
const DEBOUNCE_MS = 600;

export function InstructionsTab() {
  const systemPrompt = useAppStore((state) => state.settings.systemPrompt);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const [value, setValue] = useState(systemPrompt);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    setValue(systemPrompt);
  }, [systemPrompt]);

  useEffect(
    () => () => {
      // Flush a pending debounce when the dialog closes so keystrokes are not lost.
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending !== null) void useAppStore.getState().saveSettings({ systemPrompt: pending });
    },
    [],
  );

  useEffect(() => {
    if (status !== 'saved') return;
    const handle = window.setTimeout(() => setStatus('idle'), 2200);
    return () => window.clearTimeout(handle);
  }, [status]);

  const persist = (next: string) => {
    pendingRef.current = null;
    setStatus('saving');
    void saveSettings({ systemPrompt: next }).finally(() => setStatus('saved'));
  };

  const scheduleSave = (next: string) => {
    pendingRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      persist(next);
    }, DEBOUNCE_MS);
  };

  const handleChange = (next: string) => {
    const limited = next.slice(0, MAX_LENGTH);
    setValue(limited);
    setStatus('idle');
    scheduleSave(limited);
  };

  const flush = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    persist(value);
  };
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Instruções do sistema"
        description="Um prompt personalizado anexado a todas as conversas, além das instruções padrão da Lumina."
      >
        <SettingsBlock>
          <Textarea
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            onBlur={flush}
            rows={12}
            aria-label="Instruções do sistema"
            placeholder={
              'Ex.: “Responda em português brasileiro, com objetividade. Use tabelas quando fizer sentido e cite fontes ao usar a busca.”\n\nDeixe em branco para usar apenas as instruções padrão da Lumina (idioma, ferramentas, formato de UI generativa e segurança).'
            }
            className="min-h-[240px] resize-y font-normal"
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-foreground-subtle">
            <span>
              {value.length.toLocaleString('pt-BR')} / {MAX_LENGTH.toLocaleString('pt-BR')}{' '}
              caracteres
            </span>
            <span
              aria-live="polite"
              className={status === 'saved' ? 'text-success' : 'text-foreground-subtle'}
            >
              {status === 'saving' ? 'Salvando…' : status === 'saved' ? 'Salvo' : 'Salvamento automático'}
            </span>
          </div>
        </SettingsBlock>
      </SettingsSection>

      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-[11px] leading-relaxed text-foreground-muted">
        As instruções personalizadas não substituem as regras internas de segurança, o formato de UI
        generativa nem a política de artefatos — elas apenas orientam tom e estilo das respostas.
      </p>
    </div>
  );
}
