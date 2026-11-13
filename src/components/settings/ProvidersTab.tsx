import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
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
import { formatDate } from '@/lib/i18n/format';
import { copyText } from '@/lib/utils';
import type {
  LoginChallenge,
  ProviderAuthStatus,
  ProviderInfo,
  ProviderKeyStatus,
  Settings,
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
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

type TestState =
  | { status: 'ok'; latencyMs: number | null; models: number }
  | { status: 'error'; message: string };

/** Numeric inputs of the provider-resilience settings. */
interface ResilienceValues {
  headersTimeout: number;
  firstEventTimeout: number;
  idleTimeout: number;
  totalTimeout: number;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  maxElapsed: number;
  afterCap: number;
}

function resilienceFrom(settings: Settings): ResilienceValues {
  return {
    headersTimeout: settings.providerHeadersTimeoutSecs ?? 120,
    firstEventTimeout: settings.providerFirstEventTimeoutSecs ?? 180,
    idleTimeout: settings.providerIdleTimeoutSecs ?? 120,
    totalTimeout: settings.providerTotalTimeoutSecs ?? 1_800,
    maxRetries: settings.providerMaxRetries ?? 3,
    baseDelay: settings.providerRetryBaseDelayMs ?? 800,
    maxDelay: settings.providerRetryMaxDelayMs ?? 20_000,
    maxElapsed: settings.providerRetryMaxElapsedMs ?? 90_000,
    afterCap: settings.providerRetryAfterCapMs ?? 60_000,
  };
}

/** ChatGPT usage dashboard (also the OpenAI provider console URL). */
const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** localStorage flag for the one-time "using your plan" notice. */
const PLAN_NOTICE_KEY = 'zylara.openaiPlanNoticeShown';

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
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
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
function apiKeyPlaceholder(
  provider: ProviderInfo,
  hasKey: boolean,
  t: TFunction<'settings'>,
): string {
  if (hasKey) return t('providers.keyPlaceholder.replace');
  if (provider.id === 'openai') return t('providers.keyPlaceholder.openai');
  if (provider.id === 'anthropic') return t('providers.keyPlaceholder.anthropic');
  if (provider.id === 'gemini') return t('providers.keyPlaceholder.gemini');
  if (provider.id.startsWith('opencode-')) return t('providers.keyPlaceholder.opencode');
  return t('providers.keyPlaceholder.generic', { name: provider.name });
}

/**
 * One-time confirmation shown after the first successful ChatGPT sign-in.
 * Persisted in localStorage so it never blocks the flow again.
 */
function PlanNoticeDialog({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const { t } = useTranslation('settings');
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
            {t('providers.planNotice.title')}
          </DialogTitle>
          <DialogDescription>{t('providers.planNotice.body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-end border-0 px-5 py-4">
          <Button variant="primary" onClick={onDismiss} autoFocus>
            {t('providers.planNotice.dismiss')}
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
function AccountBadge({ auth, pending }: AccountState) {
  const { t } = useTranslation('settings');
  if (pending) {
    return (
      <Badge tone="accent" size="md" className="gap-1.5">
        <Spinner size="xs" />
        {t('providers.account.pending')}
      </Badge>
    );
  }
  switch (auth?.state) {
    case 'signed-in':
      return (
        <Badge tone={auth.planUsage ? 'accent' : 'warning'} size="md">
          {auth.planUsage ? t('providers.account.plan') : t('providers.account.connected')}
        </Badge>
      );
    case 'plan-disabled':
      return (
        <Badge tone="warning" size="md">
          {t('providers.account.planDisabled')}
        </Badge>
      );
    case 'reauth-required':
      return (
        <Badge tone="danger" size="md">
          {t('providers.account.reauth')}
        </Badge>
      );
    default:
      return (
        <Badge tone="warning" size="md">
          {t('providers.account.none')}
        </Badge>
      );
  }
}

export function ProvidersTab() {
  const { t } = useTranslation('settings');
  const { t: common } = useTranslation('common');
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
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const [resilience, setResilience] = useState<ResilienceValues>(() =>
    resilienceFrom(settings),
  );

  useEffect(
    () => setResilience(resilienceFrom(settings)),
    [settings],
  );

  const updateResilience = (
    key: keyof ResilienceValues,
    value: number,
    min: number,
    max: number,
    patch: (clamped: number) => Partial<Settings>,
  ) => {
    const clamped = Math.max(min, Math.min(max, Math.round(value) || min));
    setResilience((current) => ({ ...current, [key]: clamped }));
    void saveSettings(patch(clamped));
  };

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

  const keySourceLabel = (source: ProviderKeyStatus['source']): string => {
    switch (source) {
      case 'settings':
        return t('providers.keySource.settings');
      case 'env':
        return t('providers.keySource.env');
      case 'opencode-cli':
        return t('providers.keySource.opencode-cli');
      case 'chatgpt':
        return t('providers.keySource.chatgpt');
      default:
        return t('providers.keySource.none');
    }
  };

  /** Curated catalog copy: known provider ids use localized keys. */
  const descriptionOf = (provider: ProviderInfo): string => {
    switch (provider.id) {
      case 'opencode-go':
        return t('providers.description.opencode-go');
      case 'opencode-zen':
        return t('providers.description.opencode-zen');
      case 'openai':
        return t('providers.description.openai');
      case 'anthropic':
        return t('providers.description.anthropic');
      case 'gemini':
        return t('providers.description.gemini');
      default:
        return provider.description;
    }
  };

  /** Curated catalog notes: unknown providers keep the catalog data as-is. */
  const notesOf = (provider: ProviderInfo): string[] => {
    switch (provider.id) {
      case 'opencode-go':
        return [t('providers.notes.opencode-go.0'), t('providers.notes.opencode-go.1')];
      case 'opencode-zen':
        return [t('providers.notes.opencode-zen.0'), t('providers.notes.opencode-zen.1')];
      case 'openai':
        return [
          t('providers.notes.openai.0'),
          t('providers.notes.openai.1'),
          t('providers.notes.openai.2'),
        ];
      case 'anthropic':
        return [
          t('providers.notes.anthropic.0'),
          t('providers.notes.anthropic.1'),
          t('providers.notes.anthropic.2'),
          t('providers.notes.anthropic.3'),
        ];
      case 'gemini':
        return [
          t('providers.notes.gemini.0'),
          t('providers.notes.gemini.1'),
          t('providers.notes.gemini.2'),
          t('providers.notes.gemini.3'),
        ];
      default:
        return provider.notes;
    }
  };

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
      toast.error(t('providers.toasts.copyFailed'), {
        description: t('providers.toasts.copyFailedBody'),
      });
      return;
    }
    setCopiedLink(true);
    toast.success(t('providers.toasts.copiedTitle'));
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
        toast.success(t('providers.toasts.successTitle'), {
          description: status.planUsage
            ? t('providers.toasts.successPlan')
            : t('providers.toasts.successNoPlan'),
        });
      } else if (status.state === 'plan-disabled') {
        setLoginError(providerId, t('providers.toasts.planDisabled'));
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
      // loopback callback (the URL stays visible for "Open again").
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
      toast.success(t('providers.toasts.signOutTitle'), {
        description: t('providers.toasts.signOutBody'),
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
        toast.success(t('providers.toasts.keySaved'), {
          description: keySourceLabel(key.source),
        });
      } else {
        toast.error(t('providers.toasts.keySaveFailed'));
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
        toast.success(t('providers.toasts.keyRemoved'));
      } else {
        toast.info(t('providers.toasts.keyStillDetected'), {
          description: t('providers.toasts.keyStillDetectedBody', {
            source: keySourceLabel(key.source),
          }),
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
          : { status: 'error', message: result.message ?? t('providers.testFailed') },
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
          {test.latencyMs != null
            ? t('providers.testOkLatency', {
                latency: Math.round(test.latencyMs),
                count: test.models,
              })
            : t('providers.testOkNoLatency', { count: test.models })}
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
        {t('providers.test')}
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
      toast.error(t('toasts.openFolderFailed'), { description: errorMessage(error) });
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
            placeholder={apiKeyPlaceholder(provider, Boolean(key?.hasKey), t)}
            aria-label={t('providers.apiKeyAria', { name: provider.name })}
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
            {common('actions.save')}
          </Button>
          {key?.hasKey ? (
            <Button variant="ghost" onClick={() => void removeKey(provider.id)} disabled={isSaving}>
              {common('actions.remove')}
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
            {t('providers.test')}
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
          {hasKey ? keySourceLabel(key?.source ?? 'none') : t('providers.keyMissing')}
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
    const notes = notesOf(provider);

    return (
      <SettingsSection
        key={provider.id}
        title={provider.name}
        description={descriptionOf(provider)}
      >
        <SettingsBlock>
          <div className="flex flex-wrap items-center gap-2">
            <AccountBadge auth={authStatus} pending={pending} />
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
              {signedIn ? t('providers.manageUsage') : t('providers.console')}
            </Button>
          </div>

          {pending ? (
            <div className="mt-3 rounded-xl border border-border bg-surface px-3 py-3">
              <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                <Spinner size="sm" label={t('providers.login.pendingSpinner')} />
                {t('providers.login.pendingTitle')}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-muted">
                {t('providers.login.pendingBody')}
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
                  {copiedLink ? t('providers.login.copiedLink') : t('providers.login.copyLink')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => challenge && void openExternal(challenge.authUrl)}
                  disabled={!challenge}
                  rightIcon={<ExternalLink className="size-3.5" />}
                >
                  {t('providers.login.openAgain')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void cancelLogin()}
                  loading={canceling}
                >
                  {common('actions.cancel')}
                </Button>
              </div>
              {challenge?.browserOpened === false ? (
                <div className="mt-2.5 flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-warning">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t('providers.login.browserNotOpenedTitle')}</p>
                    <p className="mt-0.5 text-foreground-muted">
                      {t('providers.login.browserNotOpenedBody')}
                    </p>
                    {challenge.browserError ? (
                      <details className="mt-1.5 text-[11px] text-foreground-subtle">
                        <summary className="cursor-pointer select-none">
                          {t('providers.login.errorDetails')}
                        </summary>
                        <code className="mt-1 block break-all font-mono">
                          {challenge.browserError}
                        </code>
                      </details>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
                <Trans ns="settings" i18nKey="providers.login.browserHint" components={{ b: <span className="font-medium" /> }} />
              </p>
              {challenge ? (
                <details className="mt-1.5 text-[11px] text-foreground-subtle">
                  <summary className="cursor-pointer select-none">{t('providers.login.showLink')}</summary>
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
                <p className="font-medium">{t('providers.planDisabled.title')}</p>
                <p className="mt-0.5 text-foreground-muted">{t('providers.planDisabled.body')}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={starting}
                    onClick={() => void beginLogin(provider, true)}
                  >
                    {t('providers.planDisabled.activate')}
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
                    {showKeyForm
                      ? t('providers.planDisabled.hideKey')
                      : t('providers.planDisabled.useKey')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={signingOut}
                    onClick={() => void signOut(provider.id)}
                    leftIcon={<LogOut className="size-3.5" />}
                  >
                    {t('providers.signedIn.signOut')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {!pending && state === 'reauth-required' ? (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-danger">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t('providers.reauth.title')}</p>
                <p className="mt-0.5 text-foreground-muted">
                  {authStatus?.hint?.trim() || t('providers.reauth.hintFallback')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={starting}
                    onClick={() => void beginLogin(provider)}
                    leftIcon={<LogIn className="size-3.5" />}
                  >
                    {t('providers.reauth.reconnect')}
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
                    {showKeyForm
                      ? t('providers.planDisabled.hideKey')
                      : t('providers.planDisabled.useKey')}
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
                  {t('providers.signedOut.continue')}
                </Button>
                <Button variant="secondary" onClick={() => setKeyFormOpen((current) => ({ ...current, [provider.id]: !showKeyForm }))}>
                  {showKeyForm
                    ? t('providers.planDisabled.hideKey')
                    : t('providers.planDisabled.useKey')}
                </Button>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-foreground-muted">
                <Trans
                  ns="settings"
                  i18nKey="providers.signedOut.body"
                  components={{ code: <code className="font-mono" /> }}
                />
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
                {t('providers.signedIn.signOut')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setKeyFormOpen((current) => ({ ...current, [provider.id]: !showKeyForm }))}
              >
                {showKeyForm
                  ? t('providers.planDisabled.hideKey')
                  : t('providers.signedIn.useKeyAlternative')}
              </Button>
            </div>
          ) : null}

          {!pending && signedIn ? (
            <details className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-[11px] text-foreground-muted">
              <summary className="cursor-pointer select-none font-medium text-foreground">
                {t('providers.accountDetails.summary')}
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-foreground-subtle">{t('providers.accountDetails.clientId')}</dt>
                <dd className="truncate font-mono" title={authStatus?.clientIdMasked ?? undefined}>
                  {authStatus?.clientIdMasked ?? '—'}
                </dd>
                <dt className="text-foreground-subtle">{t('providers.accountDetails.hostId')}</dt>
                <dd className="truncate font-mono" title={authStatus?.hostIdMasked ?? undefined}>
                  {authStatus?.hostIdMasked ?? '—'}
                </dd>
                <dt className="text-foreground-subtle">{t('providers.accountDetails.scopes')}</dt>
                <dd className="break-words font-mono">
                  {authStatus?.scopes?.length ? authStatus.scopes.join(', ') : '—'}
                </dd>
                <dt className="text-foreground-subtle">{t('providers.accountDetails.expires')}</dt>
                <dd>{formatExpiry(authStatus?.expiresAt)}</dd>
              </dl>
              <p className="mt-2 text-[10.5px] leading-relaxed text-foreground-subtle">
                {t('providers.accountDetails.tokensNote')}
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

          {notes.length ? (
            <ul className="mt-3 flex flex-col gap-1 text-[11px] leading-relaxed text-foreground-subtle">
              {notes.map((note) => (
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
    const notes = notesOf(provider);
    return (
      <SettingsSection
        key={provider.id}
        title={provider.name}
        description={descriptionOf(provider)}
      >
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
              {t('providers.console')}
            </Button>
          </div>
          <div className="mt-3">{renderKeyControls(provider, key)}</div>
          {notes.length ? (
            <ul className="mt-3 flex flex-col gap-1 text-[11px] leading-relaxed text-foreground-subtle">
              {notes.map((note) => (
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
          <Trans
            ns="settings"
            i18nKey="providers.securityNote"
            components={{ code: <code className="font-mono" /> }}
          />
        </p>
      </div>

      {storeError ? (
        <div className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
            <p className="font-medium text-foreground">{t('providers.storeErrorTitle')}</p>
            <p className="mt-0.5 text-foreground-muted">{storeError}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setStoreError(null)}>
            {t('providers.dismiss')}
          </Button>
        </div>
      ) : null}

      {secretsError ? (
        <div className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
            <p className="font-medium text-foreground">{t('providers.secretsErrorTitle')}</p>
            <p className="mt-0.5 text-foreground-muted">
              {t('providers.secretsErrorBody', { error: secretsError })}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => void openDataDir()}
              leftIcon={<FolderOpen className="size-3.5" />}
            >
              {t('providers.openDataDir')}
            </Button>
          </div>
        </div>
      ) : null}

      {providerList.map((provider) =>
        providerAuth(provider) === 'oauth'
          ? renderChatGptCard(provider)
          : renderApiKeyCard(provider),
      )}

      <SettingsSection
        title={t('providers.resilience.title')}
        description={t('providers.resilience.description')}
      >
        <SettingsBlock>
          <SettingRow
            vertical
            label={t('providers.resilience.headers.label')}
            description={t('providers.resilience.headers.description')}
          >
            <Input
              type="number"
              min={30}
              max={600}
              value={resilience.headersTimeout}
              aria-label={t('providers.resilience.headers.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  headersTimeout: Number(event.target.value) || 30,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'headersTimeout',
                  resilience.headersTimeout,
                  30,
                  600,
                  (value) => ({ providerHeadersTimeoutSecs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.firstEvent.label')}
            description={t('providers.resilience.firstEvent.description')}
          >
            <Input
              type="number"
              min={30}
              max={900}
              value={resilience.firstEventTimeout}
              aria-label={t('providers.resilience.firstEvent.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  firstEventTimeout: Number(event.target.value) || 30,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'firstEventTimeout',
                  resilience.firstEventTimeout,
                  30,
                  900,
                  (value) => ({ providerFirstEventTimeoutSecs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.idle.label')}
            description={t('providers.resilience.idle.description')}
          >
            <Input
              type="number"
              min={15}
              max={600}
              value={resilience.idleTimeout}
              aria-label={t('providers.resilience.idle.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  idleTimeout: Number(event.target.value) || 15,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'idleTimeout',
                  resilience.idleTimeout,
                  15,
                  600,
                  (value) => ({ providerIdleTimeoutSecs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.total.label')}
            description={t('providers.resilience.total.description')}
          >
            <Input
              type="number"
              min={0}
              max={7200}
              value={resilience.totalTimeout}
              aria-label={t('providers.resilience.total.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  totalTimeout: Number(event.target.value) || 0,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'totalTimeout',
                  resilience.totalTimeout,
                  0,
                  7_200,
                  (value) => ({ providerTotalTimeoutSecs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.maxRetries.label')}
            description={t('providers.resilience.maxRetries.description')}
          >
            <Input
              type="number"
              min={0}
              max={8}
              value={resilience.maxRetries}
              aria-label={t('providers.resilience.maxRetries.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  maxRetries: Number(event.target.value) || 0,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'maxRetries',
                  resilience.maxRetries,
                  0,
                  8,
                  (value) => ({ providerMaxRetries: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.baseDelay.label')}
            description={t('providers.resilience.baseDelay.description')}
          >
            <Input
              type="number"
              min={100}
              max={5_000}
              step={100}
              value={resilience.baseDelay}
              aria-label={t('providers.resilience.baseDelay.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  baseDelay: Number(event.target.value) || 100,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'baseDelay',
                  resilience.baseDelay,
                  100,
                  5_000,
                  (value) => ({ providerRetryBaseDelayMs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.maxDelay.label')}
            description={t('providers.resilience.maxDelay.description')}
          >
            <Input
              type="number"
              min={500}
              max={60_000}
              step={500}
              value={resilience.maxDelay}
              aria-label={t('providers.resilience.maxDelay.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  maxDelay: Number(event.target.value) || 500,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'maxDelay',
                  resilience.maxDelay,
                  500,
                  60_000,
                  (value) => ({ providerRetryMaxDelayMs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.maxElapsed.label')}
            description={t('providers.resilience.maxElapsed.description')}
          >
            <Input
              type="number"
              min={0}
              max={600_000}
              step={1_000}
              value={resilience.maxElapsed}
              aria-label={t('providers.resilience.maxElapsed.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  maxElapsed: Number(event.target.value) || 0,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'maxElapsed',
                  resilience.maxElapsed,
                  0,
                  600_000,
                  (value) => ({ providerRetryMaxElapsedMs: value }),
                )
              }
            />
          </SettingRow>
          <SettingRow
            vertical
            label={t('providers.resilience.afterCap.label')}
            description={t('providers.resilience.afterCap.description')}
          >
            <Input
              type="number"
              min={1_000}
              max={600_000}
              step={1_000}
              value={resilience.afterCap}
              aria-label={t('providers.resilience.afterCap.label')}
              onChange={(event) =>
                setResilience((current) => ({
                  ...current,
                  afterCap: Number(event.target.value) || 1_000,
                }))
              }
              onBlur={() =>
                updateResilience(
                  'afterCap',
                  resilience.afterCap,
                  1_000,
                  600_000,
                  (value) => ({ providerRetryAfterCapMs: value }),
                )
              }
            />
          </SettingRow>
        </SettingsBlock>
      </SettingsSection>

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        {t('providers.privacyFooter')}
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
