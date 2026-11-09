import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { providerAuth, providerSupportsPlan, providers as catalogProviders } from '@/lib/catalog';
import { openExternal } from '@/lib/genui/open-external';
import { copyText } from '@/lib/utils';
import type {
  LoginChallenge,
  ProviderAuthStatus,
  ProviderInfo,
  ProviderKeyStatus,
} from '@/lib/types';
import { useAppStore } from '@/lib/store';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
} from '@/components/ui';
import { SettingsBlock, SettingsSection } from './shared';

type TestState =
  | { status: 'ok'; latencyMs: number | null; models: number }
  | { status: 'error'; message: string };

const KEY_SOURCE_LABEL: Record<ProviderKeyStatus['source'], string> = {
  settings: 'Configurada',
  env: 'Variável de ambiente',
  'opencode-cli': 'OpenCode CLI',
  chatgpt: 'Conta ChatGPT',
  none: 'Ausente',
};

/** ChatGPT usage dashboard (also the OpenAI provider console URL). */
const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** localStorage flag for the one-time "using your plan" notice. */
const PLAN_NOTICE_KEY = 'lumina.openaiPlanNoticeShown';

function readPlanNoticeShown(): boolean {
  try {
    return window.localStorage.getItem(PLAN_NOTICE_KEY) === '1';
  } catch {
    // Storage can be unavailable/blocked; show the notice at most once per mount.
    return false;
  }
}

function persistPlanNoticeShown(): void {
  try {
    window.localStorage.setItem(PLAN_NOTICE_KEY, '1');
  } catch {
    // Ignore: the notice simply shows again next session.
  }
}

function formatExpiry(value?: number | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Usage dashboard for an OAuth provider (catalog console URL, generic fallback). */
function planUsageUrl(provider: ProviderInfo): string {
  return provider.consoleUrl || CHATGPT_USAGE_URL;
}

/**
 * Provider-aware hint for the API-key input. Direct API-key providers do not
 * share a console, so the placeholder must name the right one (Anthropic keys
 * start with `sk-ant-`); unknown providers fall back to a generic label.
 */
function apiKeyPlaceholder(provider: ProviderInfo, hasKey: boolean): string {
  if (hasKey) return 'Colar nova chave para substituir…';
  if (provider.id === 'openai') return 'Colar API key da OpenAI…';
  if (provider.id === 'anthropic') return 'Colar API key da Anthropic (sk-ant-…)…';
  if (provider.id.startsWith('opencode-')) return 'Colar API key do OpenCode Console…';
  return `Colar API key de ${provider.name}…`;
}

/**
 * One-time confirmation shown after the first successful ChatGPT sign-in.
 * Persisted in localStorage so it never blocks the flow again.
 */
function PlanNoticeDialog({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent showClose={false} size="sm" className="p-0">
        <DialogHeader className="gap-1.5 px-5 pb-0 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-accent" />
            Você está usando seu plano ChatGPT
          </DialogTitle>
          <DialogDescription>
            Os pedidos elegíveis consomem o limite compartilhado do seu plano ChatGPT — o mesmo pool
            usado pelo ChatGPT e por outros apps. Você pode acompanhar o uso no ChatGPT a qualquer
            momento.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-end border-0 px-5 py-4">
          <Button variant="primary" onClick={onDismiss} autoFocus>
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AccountState {
  auth: ProviderAuthStatus | undefined;
  pending: boolean;
}

/** Badge describing the ChatGPT account state of an OAuth provider. */
function accountBadge({ auth, pending }: AccountState) {
  if (pending) {
    return (
      <Badge tone="accent" size="md" className="gap-1.5">
        <Spinner size="xs" />
        Aguardando…
      </Badge>
    );
  }
  switch (auth?.state) {
    case 'signed-in':
      return (
        <Badge tone={auth.planUsage ? 'accent' : 'warning'} size="md">
          {auth.planUsage ? 'Plano ChatGPT' : 'Conta conectada'}
        </Badge>
      );
    case 'plan-disabled':
      return (
        <Badge tone="warning" size="md">
          Plano não ativado
        </Badge>
      );
    case 'reauth-required':
      return (
        <Badge tone="danger" size="md">
          Sessão expirada
        </Badge>
      );
    default:
      return (
        <Badge tone="warning" size="md">
          Sem conta
        </Badge>
      );
  }
}

export function ProvidersTab() {
  const storeProviders = useAppStore((state) => state.providers);
  const keys = useAppStore((state) => state.keys);
  const auth = useAppStore((state) => state.auth);
  const secretsError = useAppStore((state) => state.secretsError);
  const storeError = useAppStore((state) => state.error);
  const setStoreError = useAppStore((state) => state.setError);
  const loginChallenge = useAppStore((state) => state.loginChallenge);
  const setProviderKey = useAppStore((state) => state.setProviderKey);
  const validateProvider = useAppStore((state) => state.validateProvider);
  const startChatGptLogin = useAppStore((state) => state.startChatGptLogin);
  const awaitChatGptLogin = useAppStore((state) => state.awaitChatGptLogin);
  const cancelChatGptLogin = useAppStore((state) => state.cancelChatGptLogin);
  const signOutProvider = useAppStore((state) => state.signOutProvider);

  const providerList: ProviderInfo[] = storeProviders.length ? storeProviders : catalogProviders();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [keyFormOpen, setKeyFormOpen] = useState<Record<string, boolean>>({});
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [signingOutId, setSigningOutId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [loginErrors, setLoginErrors] = useState<Record<string, string>>({});
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const finishingAttemptRef = useRef<string | null>(null);
  const copiedLinkTimerRef = useRef<number | null>(null);
  /** Attempts cancelled by the user: their rejection is not an error to show. */
  const canceledAttemptsRef = useRef<Set<string>>(new Set());

  const planNoticeShown = useRef(readPlanNoticeShown());

  const authStatusOf = (providerId: string): ProviderAuthStatus | undefined =>
    auth.find((entry) => entry.providerId === providerId);

  // Reopening Settings while a login is in flight must keep showing the pending
  // state (the store keeps the challenge so the URL can be reopened).
  useEffect(() => {
    if (!loginChallenge || pendingProviderId) return;
    const oauthProvider = providerList.find((provider) => providerSupportsPlan(provider));
    if (oauthProvider) setPendingProviderId(oauthProvider.id);
  }, [loginChallenge, pendingProviderId, providerList]);

  // A new attempt (or a finished one) resets the transient "copy" feedback.
  useEffect(() => {
    setCopiedLink(false);
    if (copiedLinkTimerRef.current != null) {
      window.clearTimeout(copiedLinkTimerRef.current);
      copiedLinkTimerRef.current = null;
    }
  }, [loginChallenge?.attemptId]);

  useEffect(
    () => () => {
      if (copiedLinkTimerRef.current != null) {
        window.clearTimeout(copiedLinkTimerRef.current);
      }
    },
    [],
  );

  /** Copies the authorization URL when the desktop opener cannot open a browser. */
  const copyLoginLink = async (url: string) => {
    const copied = await copyText(url);
    if (!copied) {
      toast.error('Não foi possível copiar o link', {
        description: 'Abra "Mostrar link de login" e copie o endereço manualmente.',
      });
      return;
    }
    setCopiedLink(true);
    toast.success('Link de login copiado');
    if (copiedLinkTimerRef.current != null) {
      window.clearTimeout(copiedLinkTimerRef.current);
    }
    copiedLinkTimerRef.current = window.setTimeout(() => {
      copiedLinkTimerRef.current = null;
      setCopiedLink(false);
    }, 2_500);
  };

  const setLoginError = (providerId: string, message: string | null) => {
    setLoginErrors((current) => {
      const next = { ...current };
      if (message) next[providerId] = message;
      else delete next[providerId];
      return next;
    });
  };

  const showPlanNoticeOnce = () => {
    if (planNoticeShown.current) return;
    planNoticeShown.current = true;
    setNoticeOpen(true);
  };

  /** Waits for the loopback callback, then refreshes auth/models inside the store. */
  const finishLogin = async (attemptId: string, providerId: string) => {
    if (finishingAttemptRef.current === attemptId) return;
    finishingAttemptRef.current = attemptId;
    try {
      const status = await awaitChatGptLogin(attemptId);
      setPendingProviderId(null);
      if (status.state === 'signed-in') {
        showPlanNoticeOnce();
        toast.success('Conta ChatGPT conectada', {
          description: status.planUsage
            ? 'Os pedidos elegíveis usam o seu plano ChatGPT.'
            : 'O uso do plano não está ativado para esta conta.',
        });
      } else if (status.state === 'plan-disabled') {
        setLoginError(
          providerId,
          'A conta foi conectada, mas o uso do plano não está ativado. Use "Ativar uso do plano".',
        );
      }
    } catch (error) {
      setPendingProviderId(null);
      if (!canceledAttemptsRef.current.has(attemptId)) {
        setLoginError(providerId, errorMessage(error));
      }
      canceledAttemptsRef.current.delete(attemptId);
    } finally {
      finishingAttemptRef.current = null;
    }
  };

  const beginLogin = async (provider: ProviderInfo, forceConsent = false) => {
    if (pendingProviderId || startingId) return;
    setLoginError(provider.id, null);
    setStartingId(provider.id);
    try {
      const challenge: LoginChallenge = await startChatGptLogin(provider.id, forceConsent);
      setPendingProviderId(provider.id);
      // Two-phase flow: the backend already opened the browser; wait for the
      // loopback callback (the URL stays visible for "Abrir novamente").
      void finishLogin(challenge.attemptId, provider.id);
    } catch (error) {
      setLoginError(provider.id, errorMessage(error));
    } finally {
      setStartingId(null);
    }
  };

  const cancelLogin = async () => {
    const attemptId = useAppStore.getState().loginChallenge?.attemptId;
    setCanceling(true);
    try {
      if (attemptId) {
        canceledAttemptsRef.current.add(attemptId);
        await cancelChatGptLogin(attemptId);
      }
      setPendingProviderId(null);
    } finally {
      setCanceling(false);
    }
  };

  const signOut = async (providerId: string) => {
    setLoginError(providerId, null);
    setSigningOutId(providerId);
    try {
      await signOutProvider(providerId);
      toast.success('Conta desconectada', {
        description:
          'Os tokens foram revogados. A próxima conexão reutiliza o mesmo registro de cliente.',
      });
    } catch (error) {
      setLoginError(providerId, errorMessage(error));
    } finally {
      setSigningOutId(null);
    }
  };

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
          : { status: 'error', message: result.message ?? 'Falha na conexão com o provedor.' },
      }));
    } catch (error) {
      setTests((current) => ({
        ...current,
        [providerId]: { status: 'error', message: errorMessage(error) },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const testBadge = (providerId: string) => {
    const test = tests[providerId];
    if (!test) return null;
    if (test.status === 'ok') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 aria-hidden className="size-3.5" />
          Conectado
          {test.latencyMs != null ? ` · ${Math.round(test.latencyMs)} ms` : ''}
          {` · ${test.models} modelos`}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-danger">
        <AlertCircle aria-hidden className="size-3.5" />
        {test.message}
      </span>
    );
  };

  const renderTestRow = (providerId: string) => {
    const badge = testBadge(providerId);
    if (badge) return badge;
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => void testConnection(providerId)}
        loading={testingId === providerId}
        leftIcon={<KeyRound className="size-3.5" />}
      >
        Testar conexão
      </Button>
    );
  };

  const openUsage = (provider: ProviderInfo) => {
    void openExternal(planUsageUrl(provider));
  };

  const openDataDir = async () => {
    try {
      await api.openDataDir();
    } catch (error) {
      toast.error('Não foi possível abrir a pasta', { description: errorMessage(error) });
    }
  };

  /** API-key form shared by every provider card (Go/Zen behavior unchanged). */
  const renderKeyControls = (provider: ProviderInfo, key: ProviderKeyStatus | undefined) => {
    const draft = drafts[provider.id] ?? '';
    const isSaving = savingId === provider.id;
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
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
            placeholder={apiKeyPlaceholder(provider, Boolean(key?.hasKey))}
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
          {key?.hasKey ? (
            <Button variant="ghost" onClick={() => void removeKey(provider.id)} disabled={isSaving}>
              Remover
            </Button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void testConnection(provider.id)}
            loading={testingId === provider.id}
            leftIcon={<KeyRound className="size-3.5" />}
          >
            Testar conexão
          </Button>
          {testBadge(provider.id)}
        </div>
      </>
    );
  };

  /** Key badge row (source + masked key + env var) used by every card. */
  const renderKeySummary = (provider: ProviderInfo, key: ProviderKeyStatus | undefined) => {
    const hasKey = Boolean(key?.hasKey);
    return (
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
      </div>
    );
  };

  const renderChatGptCard = (provider: ProviderInfo) => {
    const key = keys.find((entry) => entry.providerId === provider.id);
    const authStatus = authStatusOf(provider.id);
    const pending = pendingProviderId === provider.id;
    const challenge = pending ? loginChallenge : null;
    const starting = startingId === provider.id;
    const signingOut = signingOutId === provider.id;
    const state = authStatus?.state ?? 'signed-out';
    const signedIn = state === 'signed-in';
    const error = loginErrors[provider.id];
    const showKeyForm = keyFormOpen[provider.id] ?? Boolean(key?.hasKey && !signedIn);

    return (
      <SettingsSection key={provider.id} title={provider.name} description={provider.description}>
        <SettingsBlock>
          <div className="flex flex-wrap items-center gap-2">
            {accountBadge({ auth: authStatus, pending })}
            {authStatus?.accountLabel ? (
              <span className="truncate text-xs font-medium text-foreground">
                {authStatus.accountLabel}
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => openUsage(provider)}
              rightIcon={<ExternalLink className="size-3.5" />}
            >
              {signedIn ? 'Gerenciar uso' : 'Console'}
            </Button>
          </div>

          {pending ? (
            <div className="mt-3 rounded-xl border border-border bg-surface px-3 py-3">
              <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                <Spinner size="sm" label="Aguardando o navegador" />
                Aguardando o navegador…
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-muted">
                Conclua o login no ChatGPT. Esta janela é atualizada automaticamente quando você
                volta ao Lumina.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={challenge?.browserOpened === false ? 'primary' : 'secondary'}
                  onClick={() => challenge && void copyLoginLink(challenge.authUrl)}
                  disabled={!challenge}
                  leftIcon={
                    copiedLink ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )
                  }
                >
                  {copiedLink ? 'Link copiado' : 'Copiar link'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => challenge && void openExternal(challenge.authUrl)}
                  disabled={!challenge}
                  rightIcon={<ExternalLink className="size-3.5" />}
                >
                  Abrir novamente
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void cancelLogin()}
                  loading={canceling}
                >
                  Cancelar
                </Button>
              </div>
              {challenge?.browserOpened === false ? (
                <div className="mt-2.5 flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-warning">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">O navegador não abriu automaticamente</p>
                    <p className="mt-0.5 text-foreground-muted">
                      Copie o link e cole no seu navegador. Esta janela continua aguardando a
                      confirmação do login.
                    </p>
                    {challenge.browserError ? (
                      <details className="mt-1.5 text-[11px] text-foreground-subtle">
                        <summary className="cursor-pointer select-none">Detalhes do erro</summary>
                        <code className="mt-1 block break-all font-mono">
                          {challenge.browserError}
                        </code>
                      </details>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
                Se o navegador não abrir, use <span className="font-medium">Copiar link</span> e
                cole o endereço no seu navegador.
              </p>
              {challenge ? (
                <details className="mt-1.5 text-[11px] text-foreground-subtle">
                  <summary className="cursor-pointer select-none">Mostrar link de login</summary>
                  <code className="mt-1 block max-h-24 select-all overflow-auto break-all rounded-md bg-surface-raised px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">
                    {challenge.authUrl}
                  </code>
                </details>
              ) : null}
            </div>
          ) : null}

          {!pending && state === 'plan-disabled' ? (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-warning">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">O uso do plano ChatGPT não está ativado</p>
                <p className="mt-0.5 text-foreground-muted">
                  Sua conta está conectada, mas os pedidos ainda não usam o plano. Ative o uso
                  (consentimento) para continuar com os modelos sem custo por token.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={starting}
                    onClick={() => void beginLogin(provider, true)}
                  >
                    Ativar uso do plano
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setKeyFormOpen((current) => ({
                        ...current,
                        [provider.id]: !showKeyForm,
                      }))
                    }
                  >
                    {showKeyForm ? 'Ocultar API key' : 'Usar API key'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={signingOut}
                    onClick={() => void signOut(provider.id)}
                    leftIcon={<LogOut className="size-3.5" />}
                  >
                    Sair
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {!pending && state === 'reauth-required' ? (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-danger">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Sessão do ChatGPT expirada</p>
                <p className="mt-0.5 text-foreground-muted">
                  {authStatus?.hint?.trim() ||
                    'Entre novamente para renovar a credencial. O registro da conta é reutilizado.'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={starting}
                    onClick={() => void beginLogin(provider)}
                    leftIcon={<LogIn className="size-3.5" />}
                  >
                    Conectar novamente
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setKeyFormOpen((current) => ({
                        ...current,
                        [provider.id]: !showKeyForm,
                      }))
                    }
                  >
                    {showKeyForm ? 'Ocultar API key' : 'Usar API key'}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {!pending && state === 'signed-out' ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  loading={starting}
                  onClick={() => void beginLogin(provider)}
                  leftIcon={<LogIn className="size-4" />}
                >
                  Continuar com ChatGPT
                </Button>
                <Button variant="secondary" onClick={() => setKeyFormOpen((current) => ({ ...current, [provider.id]: !showKeyForm }))}>
                  {showKeyForm ? 'Ocultar API key' : 'Usar API key'}
                </Button>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-foreground-muted">
                Pedidos elegíveis usam o seu plano ChatGPT — o limite é compartilhado entre apps,
                Codex e ChatGPT Work. Sem plano, o mesmo provedor aceita uma API key{' '}
                <code className="font-mono">sk-…</code> da plataforma.
              </p>
            </div>
          ) : null}

          {!pending && signedIn ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                loading={signingOut}
                onClick={() => void signOut(provider.id)}
                leftIcon={<LogOut className="size-3.5" />}
              >
                Sair
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setKeyFormOpen((current) => ({ ...current, [provider.id]: !showKeyForm }))}
              >
                {showKeyForm ? 'Ocultar API key' : 'Usar API key como alternativa'}
              </Button>
            </div>
          ) : null}

          {!pending && signedIn ? (
            <details className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-[11px] text-foreground-muted">
              <summary className="cursor-pointer select-none font-medium text-foreground">
                Detalhes da conta
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-foreground-subtle">ID do cliente</dt>
                <dd className="truncate font-mono" title={authStatus?.clientIdMasked ?? undefined}>
                  {authStatus?.clientIdMasked ?? '—'}
                </dd>
                <dt className="text-foreground-subtle">ID do host</dt>
                <dd className="truncate font-mono" title={authStatus?.hostIdMasked ?? undefined}>
                  {authStatus?.hostIdMasked ?? '—'}
                </dd>
                <dt className="text-foreground-subtle">Escopos</dt>
                <dd className="break-words font-mono">
                  {authStatus?.scopes?.length ? authStatus.scopes.join(', ') : '—'}
                </dd>
                <dt className="text-foreground-subtle">Expira em</dt>
                <dd>{formatExpiry(authStatus?.expiresAt)}</dd>
              </dl>
              <p className="mt-2 text-[10.5px] leading-relaxed text-foreground-subtle">
                Os tokens de acesso e de atualização ficam somente no backend e nunca são enviados à
                interface.
              </p>
            </details>
          ) : null}

          {error ? (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
              <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          {pending ? null : (
            <div className="mt-3">
              {showKeyForm ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {renderKeySummary(provider, key)}
                  </div>
                  <div className="mt-3">{renderKeyControls(provider, key)}</div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {renderTestRow(provider.id)}
                </div>
              )}
            </div>
          )}

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
  };

  const renderApiKeyCard = (provider: ProviderInfo) => {
    const key = keys.find((entry) => entry.providerId === provider.id);
    return (
      <SettingsSection key={provider.id} title={provider.name} description={provider.description}>
        <SettingsBlock>
          <div className="flex flex-wrap items-center gap-2">
            {renderKeySummary(provider, key)}
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
          <div className="mt-3">{renderKeyControls(provider, key)}</div>
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
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2.5 rounded-xl border border-border bg-surface px-4 py-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        <p className="text-[11px] leading-relaxed text-foreground-muted">
          As chaves de API (OpenCode/Anthropic) e a sessão do ChatGPT são gravadas apenas no backend
          (<code className="font-mono">secrets.json</code> no app-data) e nunca são expostas à
          interface. Também detectamos as variáveis de ambiente dos provedores e o login existente
          do OpenCode CLI.
        </p>
      </div>

      {storeError ? (
        <div className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
            <p className="font-medium text-foreground">A última ação falhou</p>
            <p className="mt-0.5 text-foreground-muted">{storeError}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setStoreError(null)}>
            Dispensar
          </Button>
        </div>
      ) : null}

      {secretsError ? (
        <div className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
            <p className="font-medium text-foreground">
              Não foi possível ler o arquivo de segredos
            </p>
            <p className="mt-0.5 text-foreground-muted">
              Nenhuma chave foi alterada. O arquivo original foi preservado; corrija ou apague o
              conteúdo inválido pela pasta de dados antes de salvar novas credenciais. Detalhe:{' '}
              <span className="font-mono">{secretsError}</span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => void openDataDir()}
              leftIcon={<FolderOpen className="size-3.5" />}
            >
              Abrir pasta de dados
            </Button>
          </div>
        </div>
      ) : null}

      {providerList.map((provider) =>
        providerAuth(provider) === 'oauth'
          ? renderChatGptCard(provider)
          : renderApiKeyCard(provider),
      )}

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        O Lumina não envia suas credenciais para nenhum servidor próprio: as requisições vão direto
        para o provedor escolhido. Ao remover uma chave salva nas configurações, a detecção por
        ambiente/CLI volta a valer, se existir. Sair do ChatGPT revoga o token de atualização e
        mantém apenas o registro da conta para a próxima conexão.
      </p>

      <PlanNoticeDialog
        open={noticeOpen}
        onDismiss={() => {
          setNoticeOpen(false);
          persistPlanNoticeShown();
        }}
      />
    </div>
  );
}
