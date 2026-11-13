import * as React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  Circle,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';

import { Badge, Button, IconButton, Input, NativeSelect, ProgressBar, Separator, Spinner } from '@/components/ui';
import { getLanguage, setLanguage, t as translate, type AppLocale } from '@/lib/i18n';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/languages';
import { cn, formatBytes } from '@/lib/utils';
import { tauriInstallerApi } from './api';
import {
  applyAction,
  beginRun,
  canAdvance,
  createInitialState,
  defaultPathFor,
  installOptions,
  nextScreen,
  pathError,
  previousScreen,
  scopeLabel,
  screenOrder,
  type InstallerScreen,
  type InstallerUiState,
} from './state';
import type {
  InstallScope,
  InstallerContext,
  InstallerEvent,
  InstallerMode,
} from './types';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return translate('installer:errors.generic');
}

function closeWindow(): void {
  void getCurrentWindow().close();
}

export function InstallerApp({ api = tauriInstallerApi }: { api?: typeof tauriInstallerApi }) {
  const { t } = useTranslation('installer');
  const [context, setContext] = React.useState<InstallerContext | null>(null);
  const [state, setState] = React.useState<InstallerUiState | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [language, setLanguageState] = React.useState<AppLocale>(() => getLanguage());

  // The renderer picks its locale; the backend needs it to localize steps,
  // errors and the window title.
  React.useEffect(() => {
    void api.setLanguage(getLanguage()).catch(() => {});
  }, [api]);

  const changeLanguage = React.useCallback(
    (code: AppLocale) => {
      void setLanguage(code, { persist: false })
        .then(() => {
          setLanguageState(code);
          return api.setLanguage(code);
        })
        .catch(() => {});
    },
    [api],
  );

  React.useEffect(() => {
    let active = true;
    api
      .context()
      .then((value) => {
        if (!active) return;
        setContext(value);
        setState(createInitialState(value));
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const onEvent = React.useCallback((event: InstallerEvent) => {
    setState((current) => (current ? applyAction(current, { type: 'event', event }) : current));
  }, []);

  const update = React.useCallback((action: Parameters<typeof applyAction>[1]) => {
    setState((current) => (current ? applyAction(current, action) : current));
  }, []);

  const startInstall = React.useCallback(async () => {
    if (!state || !context) return;
    const options = installOptions(state);
    setState((current) => (current ? beginRun(current) : current));
    try {
      if (options.scope === 'machine' && !context.isAdmin) {
        await api.relaunchElevated(options);
        return;
      }
      await api.start(options, onEvent);
    } catch (error) {
      setState((current) =>
        current
          ? applyAction(current, {
              type: 'event',
              event: { kind: 'error', message: errorMessage(error), logPath: context.logPath },
            })
          : current,
      );
    }
  }, [api, context, onEvent, state]);

  const startUninstall = React.useCallback(async () => {
    if (!state || !context) return;
    setState((current) => (current ? beginRun(current) : current));
    try {
      await api.uninstall(state.draft.purgeData, onEvent);
    } catch (error) {
      setState((current) =>
        current
          ? applyAction(current, {
              type: 'event',
              event: { kind: 'error', message: errorMessage(error), logPath: context.logPath },
            })
          : current,
      );
    }
  }, [api, context, onEvent, state]);

  if (loadError) {
    return (
      <InstallerShell
        mode="install"
        title={t('window.install')}
        language={language}
        onLanguageChange={changeLanguage}
        onClose={closeWindow}
      >
        <div className="mx-auto max-w-lg rounded-2xl bg-danger-soft p-6">
          <AlertTriangle className="mb-3 size-6 text-danger" />
          <h1 className="text-lg font-semibold text-foreground">{t('errors.loadTitle')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{loadError}</p>
          <Button className="mt-5" variant="secondary" onClick={closeWindow}>
            {t('common.close')}
          </Button>
        </div>
      </InstallerShell>
    );
  }

  if (!state || !context) {
    return (
      <InstallerShell
        mode="install"
        title={t('window.install')}
        language={language}
        onLanguageChange={changeLanguage}
        onClose={closeWindow}
      >
        <div className="flex items-center gap-3 text-sm text-foreground-muted">
          <Spinner label={t('loading.spinner')} />
          {t('loading.preparing')}
        </div>
      </InstallerShell>
    );
  }

  return (
    <InstallerShell
      mode={state.mode}
      title={state.mode === 'uninstall' ? t('window.uninstall') : t('window.install')}
      version={context.version}
      context={context}
      state={state}
      language={language}
      onLanguageChange={changeLanguage}
      onClose={closeWindow}
    >
      {state.screen === 'welcome' ? (
        state.mode === 'uninstall' ? (
          <UninstallIntroScreen
            context={context}
            onContinue={() => update({ type: 'screen', screen: 'confirmUninstall' })}
            onClose={closeWindow}
          />
        ) : (
          <WelcomeScreen context={context} onContinue={() => update({ type: 'screen', screen: nextScreen(context, 'welcome') ?? 'options' })} />
        )
      ) : null}

      {state.screen === 'scope' ? (
        <ScopeScreen
          context={context}
          state={state}
          onScope={(scope: InstallScope) =>
            update({ type: 'scope', scope, defaultPath: defaultPathFor(context, scope) })
          }
          onBack={() => update({ type: 'screen', screen: previousScreen(context, 'scope') ?? 'welcome' })}
          onContinue={() => update({ type: 'screen', screen: 'location' })}
        />
      ) : null}

      {state.screen === 'location' ? (
        <LocationScreen
          context={context}
          state={state}
          onPath={(path) => update({ type: 'path', path })}
          onBrowse={async () => {
            const selected = await open({
              directory: true,
              multiple: false,
              defaultPath: state.draft.path,
              title: t('location.browseTitle'),
            });
            if (typeof selected === 'string') update({ type: 'path', path: selected });
          }}
          onBack={() => update({ type: 'screen', screen: previousScreen(context, 'location') ?? 'welcome' })}
          onContinue={() => update({ type: 'screen', screen: 'options' })}
        />
      ) : null}

      {state.screen === 'options' ? (
        <OptionsScreen
          context={context}
          state={state}
          onOption={(key, value) => update({ type: 'option', key, value })}
          onCloseApp={async () => {
            try {
              await api.closeApp();
              setContext((current) => (current ? { ...current, appRunning: false } : current));
            } catch (error) {
              setLoadError(errorMessage(error));
            }
          }}
          onBack={() => update({ type: 'screen', screen: previousScreen(context, 'options') ?? 'welcome' })}
          onInstall={() => void startInstall()}
        />
      ) : null}

      {state.screen === 'progress' ? (
        <ProgressScreen
          state={state}
          onCancel={async () => {
            update({ type: 'cancelling', cancelling: true });
            try {
              await api.cancel();
            } catch {
              // The engine may have already finished; state events are authoritative.
            }
          }}
          onOpenLog={() => void api.openLog()}
        />
      ) : null}

      {state.screen === 'finish' ? (
        <FinishScreen
          state={state}
          onLaunch={async () => {
            try {
              await api.finish(true);
            } catch (error) {
              setLoadError(errorMessage(error));
            }
          }}
          onOpenFolder={async () => {
            try {
              await api.openFolder();
            } catch (error) {
              setLoadError(errorMessage(error));
            }
          }}
          onClose={closeWindow}
        />
      ) : null}

      {state.screen === 'confirmUninstall' ? (
        <UninstallScreen
          context={context}
          state={state}
          onPurge={(value) => update({ type: 'purge', value })}
          onRemove={() => void startUninstall()}
          onClose={closeWindow}
        />
      ) : null}

      {state.screen === 'error' ? (
        <ErrorScreen
          state={state}
          onRetry={() => update({ type: 'screen', screen: state.mode === 'uninstall' ? 'welcome' : 'options' })}
          onOpenLog={() => void api.openLog()}
          onClose={closeWindow}
        />
      ) : null}
    </InstallerShell>
  );
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

const SCREEN_LABEL_KEYS: Record<InstallerScreen, string> = {
  welcome: 'screens.welcome',
  scope: 'screens.scope',
  location: 'screens.location',
  options: 'screens.options',
  progress: 'screens.progress',
  finish: 'screens.finish',
  confirmUninstall: 'screens.confirmUninstall',
  error: 'screens.error',
};

/** The step list is shared by both modes; the progress step is named per mode. */
function screenLabelKey(screen: InstallerScreen, mode: InstallerMode): string {
  if (screen === 'progress' && mode === 'uninstall') return 'screens.progressUninstall';
  return SCREEN_LABEL_KEYS[screen];
}

function InstallerShell({
  mode,
  title,
  version,
  context,
  state,
  language,
  onLanguageChange,
  onClose,
  children,
}: {
  mode: InstallerMode;
  title: string;
  version?: string;
  context?: InstallerContext;
  state?: InstallerUiState;
  language: AppLocale;
  onLanguageChange?: (code: AppLocale) => void;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('installer');
  const screens = context ? screenOrder(context) : [];
  const currentIndex = state ? screens.indexOf(state.screen === 'error' ? 'progress' : state.screen) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between bg-surface px-4">
        <div data-tauri-drag-region className="flex items-center gap-2.5">
          <img src="/brand/zylara-mark.svg" alt="" className="size-5" draggable={false} />
          <span className="text-[13px] font-medium tracking-tight text-foreground">{title}</span>
          {version ? <Badge variant="outline">v{version}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label={t('language.label')}
            value={language}
            onChange={(event) => onLanguageChange?.(event.target.value as AppLocale)}
            wrapperClassName="w-[170px]"
            className="h-8 text-[12px]"
          >
            {SUPPORTED_LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.nativeName}
              </option>
            ))}
          </NativeSelect>
          <IconButton
            label={t('shell.close')}
            size="sm"
            onClick={onClose ?? closeWindow}
            disabled={state?.screen === 'progress' && state.starting}
          >
            <X className="size-4" strokeWidth={1.9} />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[264px] shrink-0 flex-col bg-surface px-5 pb-5 pt-7">
          <div className="flex items-center gap-3">
            <img src="/brand/zylara-tile.svg" alt="Zylara" className="size-12 rounded-xl" draggable={false} />
            <div>
              <p className="text-[15px] font-semibold tracking-tight">Zylara</p>
              <p className="text-[11px] text-foreground-subtle">
                {mode === 'uninstall' ? t('shell.mode.uninstall') : t('shell.mode.install')}
              </p>
            </div>
          </div>

          <nav aria-label={t('shell.steps')} className="mt-8">
            <ol className="space-y-1">
              {screens.map((screen, index) => {
                const active = index === currentIndex;
                const done = index < currentIndex;
                return (
                  <li key={screen} className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        done && ' bg-accent-soft text-accent',
                        active && !done && ' bg-accent text-accent-foreground',
                        !active && !done && ' text-foreground-subtle',
                      )}
                    >
                      {done ? <Check className="size-3.5" strokeWidth={2.4} /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        'text-[13px]',
                        active ? 'font-medium text-foreground' : 'text-foreground-muted',
                      )}
                    >
                      {t(screenLabelKey(screen, mode))}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="mt-auto rounded-xl bg-surface-hover p-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.9} />
              <div>
                <p className="text-[12px] font-medium text-foreground">{t('shell.local.title')}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted">
                  {t('shell.local.description')}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-6 pt-8">
            <div className="mx-auto w-full max-w-[620px]">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function ScreenHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="mb-7">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">{eyebrow}</p>
      <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-foreground-muted">{description}</p>
    </header>
  );
}

function SelectCard({
  selected,
  title,
  description,
  icon,
  onClick,
  disabled,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3.5 rounded-xl p-4 text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected
          ? ' bg-accent-soft'
          : ' bg-surface-hover hover:bg-surface-active',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          selected ? 'bg-accent/20 text-accent' : 'bg-surface-hover text-foreground-muted',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-[12.5px] leading-relaxed text-foreground-muted">{description}</span>
      </span>
      <span
        className={cn(
          'ml-auto mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ',
          selected ? ' bg-accent text-accent-foreground' : '',
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

function InstallerCheckbox({
  checked,
  onChange,
  label,
  description,
  tone = 'default',
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded ',
          checked
            ? tone === 'danger'
              ? ' bg-danger text-accent-foreground'
              : ' bg-accent text-accent-foreground'
            : ' bg-surface-hover',
        )}
      >
        {checked ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-sm font-medium', tone === 'danger' ? 'text-danger' : 'text-foreground')}>{label}</span>
        {description ? (
          <span className="mt-1 block text-[12.5px] leading-relaxed text-foreground-muted">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

function OptionRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 rounded-xl bg-surface-hover px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-transparent transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          checked ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'block size-4 rounded-full bg-surface-raised shadow-sm transition-transform duration-150',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}

function Footer({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mt-8">
      <Separator />
      <div className="flex items-center justify-between gap-4 pt-5">
        <p className="text-[11px] leading-relaxed text-foreground-subtle">{hint}</p>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Install screens                                                     */
/* ------------------------------------------------------------------ */

function WelcomeScreen({ context, onContinue }: { context: InstallerContext; onContinue: () => void }) {
  const { t } = useTranslation('installer');
  const update = context.existing != null;
  return (
    <>
      <div className="mb-7 flex items-center gap-5">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" aria-hidden="true" />
          <img src="/brand/zylara-tile.svg" alt="" className="relative size-16 rounded-2xl" draggable={false} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
            {update ? t('welcome.eyebrowUpdate') : t('welcome.eyebrowWelcome')}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
            {update ? t('welcome.titleUpdate') : t('welcome.titleInstall')}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('welcome.subtitle')}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-surface-hover p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {update
                ? t('welcome.versionAvailable', { version: context.version })
                : t('welcome.version', { version: context.version })}
            </p>
            <p className="mt-1 text-[12.5px] text-foreground-muted">
              {update
                ? t('welcome.currentInstall', {
                    version: context.existing?.version ?? '',
                    path: context.existing?.path ?? '',
                  })
                : t('welcome.duration')}
            </p>
          </div>
          <Badge variant={update ? 'accent' : 'success'} size="md">
            {update ? t('welcome.badgeUpdate') : t('welcome.badgeReady')}
          </Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <WelcomeFeature
            icon={<Sparkles className="size-4" />}
            title={t('welcome.features.models.title')}
            description={t('welcome.features.models.description')}
          />
          <WelcomeFeature
            icon={<LockKeyhole className="size-4" />}
            title={t('welcome.features.local.title')}
            description={t('welcome.features.local.description')}
          />
          <WelcomeFeature
            icon={<HardDrive className="size-4" />}
            title={t('welcome.features.complete.title')}
            description={t('welcome.features.complete.description')}
          />
          <WelcomeFeature
            icon={<Download className="size-4" />}
            title={t('welcome.features.updates.title')}
            description={t('welcome.features.updates.description')}
          />
        </div>
      </div>

      {context.existing ? (
        <div className="mt-4 rounded-xl bg-surface px-4 py-3 text-[12.5px] text-foreground-muted">
          {t('welcome.keepData')}
        </div>
      ) : null}

      <Footer hint={t('welcome.hint')}>
        <Button variant="ghost" onClick={closeWindow}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={onContinue} rightIcon={<ArrowRight className="size-4" />}>
          {update ? t('welcome.update') : t('welcome.continue')}
        </Button>
      </Footer>
    </>
  );
}

function WelcomeFeature({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-surface px-3 py-2.5">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-muted">{description}</p>
      </div>
    </div>
  );
}

function ScopeScreen({
  context,
  state,
  onScope,
  onBack,
  onContinue,
}: {
  context: InstallerContext;
  state: InstallerUiState;
  onScope: (scope: InstallScope) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation('installer');
  return (
    <>
      <ScreenHeader
        eyebrow={t('scope.eyebrow')}
        title={t('scope.title')}
        description={t('scope.description')}
      />

      <div role="radiogroup" aria-label={t('scope.radiogroup')} className="space-y-3">
        <SelectCard
          selected={state.draft.scope === 'user'}
          onClick={() => onScope('user')}
          title={t('scope.user.title')}
          description={t('scope.user.description', { path: context.defaultPathUser })}
          icon={<User className="size-4" />}
        />
        <SelectCard
          selected={state.draft.scope === 'machine'}
          onClick={() => onScope('machine')}
          title={t('scope.machine.title')}
          description={t('scope.machine.description', { path: context.defaultPathMachine })}
          icon={<Users className="size-4" />}
          disabled={!context.canElevate && !context.isAdmin}
        />
      </div>

      {state.draft.scope === 'machine' && !context.isAdmin ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-warning-soft px-4 py-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-[12.5px] leading-relaxed text-foreground-muted">
            {t('scope.elevateWarning')}
          </p>
        </div>
      ) : null}

      {context.conflicting ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-danger-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="text-[12.5px] leading-relaxed text-foreground-muted">
            <p className="font-medium text-danger">{t('scope.conflicting.title')}</p>
            <p className="mt-1">
              {t('scope.conflicting.description', {
                scope: scopeLabel(context.conflicting.scope),
                path: context.conflicting.path,
                version: context.conflicting.version,
              })}
            </p>
          </div>
        </div>
      ) : null}

      <Footer hint={t('scope.hint')}>
        <Button variant="ghost" onClick={onBack} leftIcon={<ChevronLeft className="size-4" />}>
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          disabled={!canAdvance(state, context)}
          onClick={onContinue}
          rightIcon={<ArrowRight className="size-4" />}
        >
          {t('common.continue')}
        </Button>
      </Footer>
    </>
  );
}

function LocationScreen({
  context,
  state,
  onPath,
  onBrowse,
  onBack,
  onContinue,
}: {
  context: InstallerContext;
  state: InstallerUiState;
  onPath: (path: string) => void;
  onBrowse: () => Promise<void>;
  onBack: () => void;
  onContinue: () => void;
}) {
  const problem = pathError(state.draft.path);
  const { t } = useTranslation('installer');
  return (
    <>
      <ScreenHeader
        eyebrow={t('location.eyebrow')}
        title={t('location.title')}
        description={t('location.description')}
      />

      <div className="rounded-2xl bg-surface-hover p-5">
        <label htmlFor="install-path" className="mb-2 block text-[12.5px] font-medium text-foreground">
          {t('location.label')}
        </label>
        <div className="flex gap-2">
          <Input
            id="install-path"
            value={state.draft.path}
            onChange={(event) => onPath(event.target.value)}
            invalid={Boolean(problem)}
            spellCheck={false}
            autoComplete="off"
          />
          <Button variant="secondary" onClick={() => void onBrowse()} leftIcon={<FolderOpen className="size-4" />}>
            {t('location.browse')}
          </Button>
        </div>
        {problem ? <p className="mt-2 text-[12px] text-danger">{problem}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-3 text-[12.5px]">
          <div className="rounded-lg bg-surface px-3 py-2.5">
            <p className="text-foreground-subtle">{t('location.scope')}</p>
            <p className="mt-0.5 font-medium text-foreground">{scopeLabel(state.draft.scope)}</p>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2.5">
            <p className="text-foreground-subtle">{t('location.required')}</p>
            <p className="mt-0.5 font-medium text-foreground">{formatBytes(context.requiredBytes)}</p>
          </div>
        </div>

        {context.freeBytes != null ? (
          <p className="mt-2 text-[12px] text-foreground-subtle">
            {t('location.free', { size: formatBytes(context.freeBytes) })}
          </p>
        ) : null}

        {state.draft.scope === 'machine' ? (
          <p className="mt-4 flex items-center gap-2 text-[12px] text-foreground-muted">
            <ShieldCheck className="size-3.5 text-warning" />
            {t('location.adminWarning')}
          </p>
        ) : null}
      </div>

      <Footer hint={t('location.hint')}>
        <Button variant="ghost" onClick={onBack} leftIcon={<ChevronLeft className="size-4" />}>
          {t('common.back')}
        </Button>
        <Button variant="primary" disabled={Boolean(problem)} onClick={onContinue} rightIcon={<ArrowRight className="size-4" />}>
          {t('common.continue')}
        </Button>
      </Footer>
    </>
  );
}

function OptionsScreen({
  context,
  state,
  onOption,
  onCloseApp,
  onBack,
  onInstall,
}: {
  context: InstallerContext;
  state: InstallerUiState;
  onOption: (key: 'desktopShortcut' | 'startMenuShortcut' | 'launchAfterInstall', value: boolean) => void;
  onCloseApp: () => Promise<void>;
  onBack: () => void;
  onInstall: () => void;
}) {
  const update = context.existing != null;
  const { t } = useTranslation('installer');
  return (
    <>
      <ScreenHeader
        eyebrow={update ? t('options.eyebrowUpdate') : t('options.eyebrow')}
        title={update ? t('options.titleUpdate') : t('options.title')}
        description={
          update
            ? t('options.descriptionUpdate', {
                version: context.version,
                existingVersion: context.existing?.version ?? '',
              })
            : t('options.description')
        }
      />

      {context.conflicting ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="text-[12.5px] leading-relaxed text-foreground-muted">
            <p className="font-medium text-danger">{t('options.conflicting.title')}</p>
            <p className="mt-0.5">
              {t('options.conflicting.description', {
                scope: scopeLabel(context.conflicting.scope),
                path: context.conflicting.path,
                version: context.conflicting.version,
              })}
            </p>
          </div>
        </div>
      ) : null}

      {context.appRunning ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-warning-soft px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-foreground">{t('options.running.title')}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">
              {t('options.running.description')}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void onCloseApp()}>
            {t('options.running.close')}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <OptionRow
          checked={state.draft.desktopShortcut}
          onChange={(value) => onOption('desktopShortcut', value)}
          title={t('options.desktopShortcut.title')}
          description={t('options.desktopShortcut.description')}
        />
        <OptionRow
          checked={state.draft.startMenuShortcut}
          onChange={(value) => onOption('startMenuShortcut', value)}
          title={t('options.startMenuShortcut.title')}
          description={t('options.startMenuShortcut.description')}
        />
        <OptionRow
          checked={state.draft.launchAfterInstall}
          onChange={(value) => onOption('launchAfterInstall', value)}
          title={t('options.launchAfterInstall.title')}
          description={t('options.launchAfterInstall.description')}
        />
      </div>

      <div className="mt-4 rounded-xl bg-surface px-4 py-3">
        <div className="flex items-start gap-2.5">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
          <div className="text-[12px] leading-relaxed text-foreground-muted">
            <p>
              <span className="font-medium text-foreground">{t('options.destination')}</span> {state.draft.path}
            </p>
            <p className="mt-0.5">
              <span className="font-medium text-foreground">{t('options.scope')}</span>{' '}
              {scopeLabel(state.draft.scope)}
            </p>
          </div>
        </div>
      </div>

      <Footer
        hint={
          state.draft.scope === 'machine' && !context.isAdmin
            ? t('options.hintElevate')
            : t('options.hintDefault')
        }
      >
        <Button variant="ghost" onClick={onBack} leftIcon={<ChevronLeft className="size-4" />}>
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          onClick={onInstall}
          disabled={Boolean(context.conflicting)}
          leftIcon={<Download className="size-4" />}
        >
          {update ? t('options.installUpdate') : t('options.install')}
        </Button>
      </Footer>
    </>
  );
}

function ProgressScreen({
  state,
  onCancel,
  onOpenLog,
}: {
  state: InstallerUiState;
  onCancel: () => void;
  onOpenLog: () => void;
}) {
  const done = state.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  const { t } = useTranslation('installer');
  return (
    <>
      <ScreenHeader
        eyebrow={state.mode === 'uninstall' ? t('progress.eyebrowUninstall') : t('progress.eyebrow')}
        title={state.mode === 'uninstall' ? t('progress.titleUninstall') : t('progress.title')}
        description={t('progress.description')}
      />

      <div className="rounded-2xl bg-surface-hover p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-foreground" aria-live="polite">
            {state.progressMessage || t('progress.preparing')}
          </p>
          <Badge variant="outline" size="md">
            {done}/{state.steps.length}
          </Badge>
        </div>
        <ProgressBar
          className="mt-3"
          size="md"
          value={state.progress}
          label={state.mode === 'uninstall' ? t('progress.progressUninstall') : t('progress.progress')}
        />

        <ol className="mt-5 space-y-2.5">
          {state.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ',
                  step.status === 'done' && ' bg-success-soft text-success',
                  step.status === 'running' && ' bg-accent-soft text-accent',
                  step.status === 'error' && ' bg-danger-soft text-danger',
                  step.status === 'skipped' && ' bg-surface text-foreground-subtle',
                  step.status === 'pending' && ' bg-surface text-foreground-subtle',
                )}
              >
                {step.status === 'done' ? <Check className="size-3" strokeWidth={2.5} /> : null}
                {step.status === 'running' ? <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" /> : null}
                {step.status === 'error' ? <X className="size-3" /> : null}
                {step.status === 'pending' || step.status === 'skipped' ? <Circle className="size-2" /> : null}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-[12.5px]',
                    step.status === 'pending' ? 'text-foreground-subtle' : 'text-foreground',
                    step.status === 'error' && 'text-danger',
                  )}
                >
                  {step.label}
                </p>
                {step.detail ? (
                  <p className="mt-0.5 break-all text-[11px] leading-relaxed text-foreground-subtle">{step.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <details className="group mt-5 rounded-lg bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[12px] font-medium text-foreground-muted hover:text-foreground">
            <span className="flex items-center gap-2">
              <FileText className="size-3.5" />
              {t('progress.details')}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenLog();
                }}
              >
                {t('common.openLog')}
              </button>
              <ArrowRight className="size-3.5 transition-transform group-open:rotate-90" />
            </span>
          </summary>
          <pre className="max-h-40 overflow-auto border-t border-border px-3.5 py-2.5 font-mono text-[10.5px] leading-relaxed text-foreground-subtle">
            {state.logLines.length ? state.logLines.join('\n') : t('progress.noDetails')}
          </pre>
        </details>
      </div>

      <Footer hint={t('progress.hint')}>
        <Button variant="ghost" onClick={onCancel} loading={state.cancelling} disabled={state.progress >= 30}>
          {t('common.cancel')}
        </Button>
      </Footer>
    </>
  );
}

function FinishScreen({
  state,
  onLaunch,
  onOpenFolder,
  onClose,
}: {
  state: InstallerUiState;
  onLaunch: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onClose: () => void;
}) {
  const uninstall = state.mode === 'uninstall';
  const launched = state.outcome?.launched ?? false;
  const { t } = useTranslation('installer');
  return (
    <>
      <div className="flex flex-col items-center py-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
          <Check className="size-8" strokeWidth={2.2} />
        </div>
        <h1 className="mt-5 text-[24px] font-semibold tracking-tight">
          {uninstall
            ? t('finish.titleUninstall')
            : launched
              ? t('finish.titleLaunched')
              : t('finish.titleDone')}
        </h1>
        <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-foreground-muted">
          {uninstall
            ? state.draft.purgeData
              ? t('finish.descriptionUninstallPurge')
              : t('finish.descriptionUninstall')
            : launched
              ? t('finish.descriptionLaunched')
              : t('finish.descriptionDone')}
        </p>
        {state.outcome?.installPath ? (
          <p className="mt-4 max-w-full break-all rounded-lg bg-surface px-3 py-2 font-mono text-[11px] text-foreground-subtle">
            {state.outcome.installPath}
          </p>
        ) : null}
      </div>

      <div className="flex justify-center gap-2">
        {!uninstall ? (
          <Button variant="primary" onClick={() => void onLaunch()} leftIcon={<Sparkles className="size-4" />}>
            {launched ? t('finish.openLaunched') : t('finish.open')}
          </Button>
        ) : null}
        {!uninstall ? (
          <Button variant="secondary" onClick={() => void onOpenFolder()} leftIcon={<FolderOpen className="size-4" />}>
            {t('finish.openFolder')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </>
  );
}

function UninstallIntroScreen({
  context,
  onContinue,
  onClose,
}: {
  context: InstallerContext;
  onContinue: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('installer');
  return (
    <>
      <div className="mb-7 flex items-center gap-5">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" aria-hidden="true" />
          <img src="/brand/zylara-tile.svg" alt="" className="relative size-16 rounded-2xl" draggable={false} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
            {t('uninstallIntro.eyebrow')}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
            {t('uninstallIntro.title')}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">{t('uninstallIntro.description')}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-surface-hover p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t('uninstallIntro.version', { version: context.existing?.version ?? context.version })}
            </p>
            <p className="mt-1 break-all text-[12px] text-foreground-muted">
              {context.existing?.path ?? ''}
            </p>
          </div>
          <Badge variant="outline" size="md">
            {scopeLabel(context.existing?.scope ?? 'user')}
          </Badge>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface px-3 py-2.5">
            <p className="text-[11px] text-foreground-subtle">{t('uninstallIntro.size')}</p>
            <p className="mt-0.5 text-[12.5px] font-medium text-foreground">
              {formatBytes(context.installedBytes)}
            </p>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2.5">
            <p className="text-[11px] text-foreground-subtle">{t('uninstallIntro.location')}</p>
            <p className="mt-0.5 text-[12.5px] font-medium text-foreground">
              {scopeLabel(context.existing?.scope ?? 'user')}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          <div className="flex items-start gap-2.5 rounded-lg bg-success-soft px-3.5 py-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.9} />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-foreground">{t('uninstallIntro.keepsTitle')}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">
                {t('uninstallIntro.keepsItem')}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-muted">
                {t('uninstallIntro.keepsKeys')}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg bg-surface px-3.5 py-3">
            <Trash2 className="mt-0.5 size-4 shrink-0 text-foreground-subtle" strokeWidth={1.9} />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-foreground">{t('uninstallIntro.removesTitle')}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">
                {t('uninstallIntro.removesApp')}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-muted">
                {t('uninstallIntro.removesRegistry')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {context.dataPaths.length ? (
        <div className="mt-4 rounded-xl bg-surface px-4 py-3">
          <p className="text-[12px] font-medium text-foreground">{t('uninstall.dataTitle')}</p>
          <ul className="mt-1.5 space-y-1">
            {context.dataPaths.map((path) => (
              <li key={path} className="break-all font-mono text-[11px] leading-relaxed text-foreground-muted">
                {path}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Footer hint={t('uninstallIntro.hint')}>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={onContinue} rightIcon={<ArrowRight className="size-4" />}>
          {t('uninstallIntro.continue')}
        </Button>
      </Footer>
    </>
  );
}

function UninstallScreen({
  context,
  state,
  onPurge,
  onRemove,
  onClose,
}: {
  context: InstallerContext;
  state: InstallerUiState;
  onPurge: (value: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const { t } = useTranslation('installer');
  const installPath = context.existing?.path ?? state.draft.path;
  return (
    <>
      <ScreenHeader
        eyebrow={t('uninstall.eyebrow')}
        title={t('uninstall.title')}
        description={t('uninstall.description')}
      />

      <div className="rounded-2xl bg-surface-hover p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Zylara {context.existing?.version ?? context.version}</p>
            <p className="mt-1 break-all text-[12px] text-foreground-muted">{installPath}</p>
          </div>
          <Badge variant="outline" size="md">
            {scopeLabel(context.existing?.scope ?? state.draft.scope)}
          </Badge>
        </div>

        <Separator className="my-4" />

        <InstallerCheckbox
          checked={state.draft.purgeData}
          onChange={onPurge}
          tone="danger"
          label={t('uninstall.purge.label')}
          description={t('uninstall.purge.description')}
        />
        {state.draft.purgeData ? (
          <div className="mt-2 flex items-start gap-2.5 rounded-lg bg-danger-soft px-3.5 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <p className="text-[12px] leading-relaxed text-foreground-muted">
              {t('uninstall.purgeWarning')}
            </p>
          </div>
        ) : null}
      </div>

      {context.appRunning ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-warning-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-[12px] leading-relaxed text-foreground-muted">{t('uninstall.runningNote')}</p>
        </div>
      ) : null}

      {context.dataPaths.length ? (
        <div className="mt-4 rounded-xl bg-surface px-4 py-3">
          <p className="text-[12px] font-medium text-foreground">{t('uninstall.dataTitle')}</p>
          <ul className="mt-1.5 space-y-1">
            {context.dataPaths.map((path) => (
              <li key={path} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span
                  className={cn(
                    'mt-1 size-1.5 shrink-0 rounded-full',
                    state.draft.purgeData ? 'bg-danger' : 'bg-success',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="break-all font-mono text-foreground-muted">{path}</span>
                  <span className="ml-2 text-foreground-subtle">
                    {state.draft.purgeData ? t('uninstall.dataRemoved') : t('uninstall.dataKept')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl bg-surface px-4 py-3 text-[12px] leading-relaxed text-foreground-muted">
        {state.draft.purgeData
          ? confirming
            ? t('uninstall.infoConfirm')
            : t('uninstall.infoNext')
          : t('uninstall.infoDefault')}
      </div>

      <Footer hint={t('uninstall.hint')}>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (state.draft.purgeData && !confirming) {
              setConfirming(true);
              return;
            }
            onRemove();
          }}
          leftIcon={<RotateCcw className="size-4" />}
        >
          {state.draft.purgeData && confirming ? t('uninstall.confirm') : t('uninstall.remove')}
        </Button>
      </Footer>
    </>
  );
}

function ErrorScreen({
  state,
  onRetry,
  onOpenLog,
  onClose,
}: {
  state: InstallerUiState;
  onRetry: () => void;
  onOpenLog: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('installer');
  return (
    <>
      <ScreenHeader
        eyebrow={t('errorScreen.eyebrow')}
        title={state.mode === 'uninstall' ? t('errorScreen.titleUninstall') : t('errorScreen.title')}
        description={t('errorScreen.description')}
      />

      <div className="rounded-2xl bg-danger-soft p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t('errorScreen.problem')}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground-muted">
              {state.error ?? t('errorScreen.unknown')}
            </p>
          </div>
        </div>
      </div>

      {state.outcome?.logPath || state.logLines.length ? (
        <details className="mt-4 rounded-xl bg-surface-hover">
          <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-medium text-foreground-muted hover:text-foreground">
            {t('errorScreen.technical')}
          </summary>
          <pre className="max-h-48 overflow-auto border-t border-border px-4 py-3 font-mono text-[10.5px] leading-relaxed text-foreground-subtle">
            {state.logLines.join('\n') || t('errorScreen.logFallback')}
          </pre>
        </details>
      ) : null}

      <Footer hint={t('errorScreen.hint')}>
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button variant="secondary" onClick={onOpenLog} leftIcon={<ExternalLink className="size-4" />}>
          {t('common.openLog')}
        </Button>
        <Button variant="primary" onClick={onRetry} leftIcon={<RotateCcw className="size-4" />}>
          {t('errorScreen.retry')}
        </Button>
      </Footer>
    </>
  );
}
