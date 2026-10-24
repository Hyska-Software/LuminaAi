import { useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { providers as catalogProviders } from '@/lib/catalog';
import { openExternal } from '@/lib/genui/open-external';
import type { ProviderInfo, ProviderKeyStatus } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Input } from '@/components/ui';
import { SettingsBlock, SettingsSection } from './shared';

type TestState =
  | { status: 'ok'; latencyMs: number | null; models: number }
  | { status: 'error'; message: string };

const KEY_SOURCE_LABEL: Record<ProviderKeyStatus['source'], string> = {
  settings: 'Configurada',
  env: 'Variável de ambiente',
  'opencode-cli': 'OpenCode CLI',
  none: 'Ausente',
};

export function ProvidersTab() {
  const storeProviders = useAppStore((state) => state.providers);
  const keys = useAppStore((state) => state.keys);
  const setProviderKey = useAppStore((state) => state.setProviderKey);
  const validateProvider = useAppStore((state) => state.validateProvider);

  const providerList: ProviderInfo[] = storeProviders.length ? storeProviders : catalogProviders();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const saveKey = async (providerId: string) => {
    const value = (drafts[providerId] ?? '').trim();
    if (!value) return;
    setSavingId(providerId);
    try {
      await setProviderKey(providerId, value);
      const key = useAppStore.getState().keys.find((entry) => entry.providerId === providerId);
      if (key?.hasKey) {
        setDrafts((current) => ({ ...current, [providerId]: '' }));
        toast.success('Chave salva', { description: KEY_SOURCE_LABEL[key.source] });
      } else {
        toast.error('Não foi possível salvar a chave');
      }
    } finally {
      setSavingId(null);
    }
  };

  const removeKey = async (providerId: string) => {
    setSavingId(providerId);
    try {
      await setProviderKey(providerId, null);
      const key = useAppStore.getState().keys.find((entry) => entry.providerId === providerId);
      if (!key?.hasKey) {
        toast.success('Chave removida');
      } else {
        toast.info('Chave salva removida', {
          description: `Ainda há uma chave detectada via ${KEY_SOURCE_LABEL[key.source]}.`,
        });
      }
    } finally {
      setSavingId(null);
    }
  };

  const testConnection = async (providerId: string) => {
    setTestingId(providerId);
    setTests((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    try {
      const result = await validateProvider(providerId);
      setTests((current) => ({
        ...current,
        [providerId]: result.ok
          ? { status: 'ok', latencyMs: result.latencyMs ?? null, models: result.models }
          : { status: 'error', message: result.message ?? 'Falha na conexão com o gateway.' },
      }));
    } catch (error) {
      setTests((current) => ({
        ...current,
        [providerId]: {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2.5 rounded-xl border border-border bg-surface px-4 py-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        <p className="text-[11px] leading-relaxed text-foreground-muted">
          As chaves são gravadas apenas no backend (<code className="font-mono">secrets.json</code> no
          app-data) e nunca são expostas à interface. Também detectamos a variável{' '}
          <code className="font-mono">OPENCODE_API_KEY</code> e o login existente do OpenCode CLI.
        </p>
      </div>

      {providerList.map((provider) => {
        const key = keys.find((entry) => entry.providerId === provider.id);
        const hasKey = Boolean(key?.hasKey);
        const draft = drafts[provider.id] ?? '';
        const test = tests[provider.id];
        const isSaving = savingId === provider.id;
        const isTesting = testingId === provider.id;

        return (
          <SettingsSection key={provider.id} title={provider.name} description={provider.description}>
            <SettingsBlock>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={hasKey ? 'success' : 'warning'} size="md">
                  {hasKey ? KEY_SOURCE_LABEL[key?.source ?? 'none'] : 'Chave ausente'}
                </Badge>
                {key?.masked ? (
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground-subtle">
                    {key.masked}
                  </code>
                ) : null}
                <span className="text-[11px] text-foreground-subtle">
                  env: <code className="font-mono">{provider.authEnv}</code>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void openExternal(provider.consoleUrl)}
                  rightIcon={<ExternalLink className="size-3.5" />}
                >
                  Console
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void saveKey(provider.id);
                    }
                  }}
                  placeholder={
                    hasKey ? 'Colar nova chave para substituir…' : 'Colar API key do OpenCode Console…'
                  }
                  aria-label={`API key de ${provider.name}`}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-[200px] flex-1"
                />
                <Button
                  variant="primary"
                  onClick={() => void saveKey(provider.id)}
                  loading={isSaving}
                  disabled={!draft.trim() || isSaving}
                >
                  Salvar
                </Button>
                {hasKey ? (
                  <Button
                    variant="ghost"
                    onClick={() => void removeKey(provider.id)}
                    disabled={isSaving}
                  >
                    Remover
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void testConnection(provider.id)}
                  loading={isTesting}
                  leftIcon={<KeyRound className="size-3.5" />}
                >
                  Testar conexão
                </Button>
                {test ? (
                  test.status === 'ok' ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
                      <CheckCircle2 aria-hidden className="size-3.5" />
                      Conectado
                      {test.latencyMs != null ? ` · ${Math.round(test.latencyMs)} ms` : ''}
                      {` · ${test.models} modelos`}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-danger">
                      <AlertCircle aria-hidden className="size-3.5" />
                      {test.message}
                    </span>
                  )
                ) : null}
              </div>

              {provider.notes.length ? (
                <ul className="mt-3 flex flex-col gap-1 text-[11px] leading-relaxed text-foreground-subtle">
                  {provider.notes.map((note) => (
                    <li key={note}>• {note}</li>
                  ))}
                </ul>
              ) : null}
            </SettingsBlock>
          </SettingsSection>
        );
      })}

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        O Lumina não envia suas chaves para nenhum servidor próprio: as requisições vão direto para o
        gateway do OpenCode. Ao remover uma chave salva nas configurações, a detecção por ambiente/CLI
        volta a valer, se existir.
      </p>
    </div>
  );
}
