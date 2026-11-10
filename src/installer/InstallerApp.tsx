import * as React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
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
  User,
  Users,
  X,
} from 'lucide-react';

import { Badge, Button, IconButton, Input, ProgressBar, Separator, Spinner } from '@/components/ui';
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
  return 'Não foi possível concluir a operação.';
}

function closeWindow(): void {
  void getCurrentWindow().close();
}

export function InstallerApp({ api = tauriInstallerApi }: { api?: typeof tauriInstallerApi }) {
  const [context, setContext] = React.useState<InstallerContext | null>(null);
  const [state, setState] = React.useState<InstallerUiState | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

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
      <InstallerShell mode="install" title="Zylara Setup" onClose={closeWindow}>
        <div className="mx-auto max-w-lg rounded-2xl border border-danger/30 bg-danger-soft p-6">
          <AlertTriangle className="mb-3 size-6 text-danger" />
          <h1 className="text-lg font-semibold text-foreground">Não foi possível abrir o instalador</h1>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{loadError}</p>
          <Button className="mt-5" variant="secondary" onClick={closeWindow}>
            Fechar
          </Button>
        </div>
      </InstallerShell>
    );
  }

  if (!state || !context) {
    return (
      <InstallerShell mode="install" title="Zylara Setup" onClose={closeWindow}>
        <div className="flex items-center gap-3 text-sm text-foreground-muted">
          <Spinner label="Carregando instalador" />
          Preparando o instalador…
        </div>
      </InstallerShell>
    );
  }

  return (
    <InstallerShell
      mode={state.mode}
      title={state.mode === 'uninstall' ? 'Desinstalar Zylara' : 'Zylara Setup'}
      version={context.version}
      context={context}
      state={state}
      onClose={closeWindow}
    >
      {state.screen === 'welcome' ? (
        <WelcomeScreen context={context} onContinue={() => update({ type: 'screen', screen: nextScreen(context, 'welcome') ?? 'options' })} />
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
              title: 'Escolha a pasta de instalação',
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
          onRetry={() => update({ type: 'screen', screen: state.mode === 'uninstall' ? 'confirmUninstall' : 'options' })}
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

const SCREEN_LABELS: Record<InstallerScreen, string> = {
  welcome: 'Boas-vindas',
  scope: 'Escopo',
  location: 'Destino',
  options: 'Opções',
  progress: 'Instalação',
  finish: 'Concluído',
  confirmUninstall: 'Remover',
  error: 'Erro',
};

function flowScreens(context: InstallerContext): InstallerScreen[] {
  if (context.mode === 'uninstall') return ['confirmUninstall', 'progress', 'finish'];
  if (context.existing) return ['welcome', 'options', 'progress', 'finish'];
  return ['welcome', 'scope', 'location', 'options', 'progress', 'finish'];
}

function InstallerShell({
  mode,
  title,
  version,
  context,
  state,
  onClose,
  children,
}: {
  mode: InstallerMode;
  title: string;
  version?: string;
  context?: InstallerContext;
  state?: InstallerUiState;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const screens = context ? flowScreens(context) : [];
  const currentIndex = state ? screens.indexOf(state.screen === 'error' ? 'progress' : state.screen) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between bg-surface px-4">
        <div data-tauri-drag-region className="flex items-center gap-2.5">
          <img src="/brand/zylara-mark.svg" alt="" className="size-5" draggable={false} />
          <span className="text-[13px] font-medium tracking-tight text-foreground">{title}</span>
          {version ? <Badge variant="outline">v{version}</Badge> : null}
        </div>
        <IconButton
          label="Fechar instalador"
          size="sm"
          onClick={onClose ?? closeWindow}
          disabled={state?.screen === 'progress' && state.starting}
        >
          <X className="size-4" strokeWidth={1.9} />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[264px] shrink-0 flex-col bg-surface px-5 pb-5 pt-7">
          <div className="flex items-center gap-3">
            <img src="/brand/zylara-tile.svg" alt="Zylara" className="size-12 rounded-xl" draggable={false} />
            <div>
              <p className="text-[15px] font-semibold tracking-tight">Zylara</p>
              <p className="text-[11px] text-foreground-subtle">
                {mode === 'uninstall' ? 'Desinstalação' : 'Instalador'}
              </p>
            </div>
          </div>

          <nav aria-label="Etapas" className="mt-8">
            <ol className="space-y-1">
              {screens.map((screen, index) => {
                const active = index === currentIndex;
                const done = index < currentIndex;
                return (
                  <li key={screen} className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                        done && 'border-accent/40 bg-accent-soft text-accent',
                        active && !done && 'border-accent bg-accent text-accent-foreground',
                        !active && !done && 'border-border text-foreground-subtle',
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
                      {SCREEN_LABELS[screen]}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="mt-auto rounded-xl border border-border bg-surface-raised p-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.9} />
              <div>
                <p className="text-[12px] font-medium text-foreground">Instalação local</p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted">
                  Seus dados ficam neste computador. Nada é enviado para nós.
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
        'flex w-full items-start gap-3.5 rounded-xl border p-4 text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected
          ? 'border-accent/60 bg-accent-soft'
          : 'border-border bg-surface-raised hover:border-border-strong hover:bg-surface-hover',
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
          'ml-auto mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border-strong',
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
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
          checked
            ? tone === 'danger'
              ? 'border-danger bg-danger text-accent-foreground'
              : 'border-accent bg-accent text-accent-foreground'
            : 'border-border-strong bg-surface-raised',
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
    <div className="flex items-center justify-between gap-5 rounded-xl border border-border bg-surface-raised px-4 py-3.5">
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
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-150',
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
            {update ? 'Atualização' : 'Bem-vindo'}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
            {update ? 'Atualize o Zylara' : 'Instale o Zylara'}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Chat desktop com agentes, documentos e código.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {update ? `Versão ${context.version} disponível` : `Versão ${context.version}`}
            </p>
            <p className="mt-1 text-[12.5px] text-foreground-muted">
              {update
                ? `Instalação atual: ${context.existing?.version} em ${context.existing?.path}`
                : 'A instalação leva menos de um minuto.'}
            </p>
          </div>
          <Badge variant={update ? 'accent' : 'success'} size="md">
            {update ? 'Atualizar' : 'Pronto'}
          </Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <WelcomeFeature icon={<Sparkles className="size-4" />} title="Seus modelos" description="OpenCode, OpenAI e Anthropic em um só lugar." />
          <WelcomeFeature icon={<LockKeyhole className="size-4" />} title="Local-first" description="Conversas e arquivos ficam no seu computador." />
          <WelcomeFeature icon={<HardDrive className="size-4" />} title="Completo" description="Biblioteca, código, terminal e skills inclusos." />
          <WelcomeFeature icon={<Download className="size-4" />} title="Atualização simples" description="Execute o novo instalador quando quiser." />
        </div>
      </div>

      {context.existing ? (
        <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-[12.5px] text-foreground-muted">
          Atualizar mantém suas conversas, arquivos, configurações e chaves de API.
        </div>
      ) : null}

      <Footer hint="Ao continuar, você poderá escolher onde e para quem instalar.">
        <Button variant="ghost" onClick={closeWindow}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={onContinue} rightIcon={<ArrowRight className="size-4" />}>
          {update ? 'Atualizar Zylara' : 'Continuar'}
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
  return (
    <>
      <ScreenHeader
        eyebrow="Etapa 1 de 3"
        title="Para quem vamos instalar?"
        description="Escolha o escopo. A opção por usuário não pede administrador; a opção para todos deixa o Zylara disponível para qualquer conta deste computador."
      />

      <div role="radiogroup" aria-label="Escopo da instalação" className="space-y-3">
        <SelectCard
          selected={state.draft.scope === 'user'}
          onClick={() => onScope('user')}
          title="Apenas para mim"
          description={`Instala em ${context.defaultPathUser}. Não exige permissão de administrador.`}
          icon={<User className="size-4" />}
        />
        <SelectCard
          selected={state.draft.scope === 'machine'}
          onClick={() => onScope('machine')}
          title="Para todos os usuários"
          description={`Instala em ${context.defaultPathMachine}. O Windows pedirá permissão de administrador.`}
          icon={<Users className="size-4" />}
          disabled={!context.canElevate && !context.isAdmin}
        />
      </div>

      {state.draft.scope === 'machine' && !context.isAdmin ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-[12.5px] leading-relaxed text-foreground-muted">
            Ao continuar, o instalador vai reabrir com permissões de administrador para criar atalhos e registrar o app para todos.
          </p>
        </div>
      ) : null}

      {context.conflicting ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="text-[12.5px] leading-relaxed text-foreground-muted">
            <p className="font-medium text-danger">Já existe uma instalação em outro escopo.</p>
            <p className="mt-1">
              {scopeLabel(context.conflicting.scope)} em {context.conflicting.path} (v{context.conflicting.version}).
              Remova essa instalação antes de continuar.
            </p>
          </div>
        </div>
      ) : null}

      <Footer hint="Você poderá mudar a pasta na próxima etapa.">
        <Button variant="ghost" onClick={onBack} leftIcon={<ChevronLeft className="size-4" />}>
          Voltar
        </Button>
        <Button
          variant="primary"
          disabled={!canAdvance(state, context)}
          onClick={onContinue}
          rightIcon={<ArrowRight className="size-4" />}
        >
          Continuar
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
  return (
    <>
      <ScreenHeader
        eyebrow="Etapa 2 de 3"
        title="Onde instalar?"
        description="A pasta será criada se ainda não existir. O Zylara precisa de uma unidade local para o banco de dados e os checkpoints."
      />

      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <label htmlFor="install-path" className="mb-2 block text-[12.5px] font-medium text-foreground">
          Pasta de instalação
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
            Procurar…
          </Button>
        </div>
        {problem ? <p className="mt-2 text-[12px] text-danger">{problem}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-3 text-[12.5px]">
          <div className="rounded-lg bg-surface px-3 py-2.5">
            <p className="text-foreground-subtle">Escopo</p>
            <p className="mt-0.5 font-medium text-foreground">{scopeLabel(state.draft.scope)}</p>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2.5">
            <p className="text-foreground-subtle">Espaço necessário</p>
            <p className="mt-0.5 font-medium text-foreground">{formatBytes(context.requiredBytes)}</p>
          </div>
        </div>

        {context.freeBytes != null ? (
          <p className="mt-2 text-[12px] text-foreground-subtle">
            {formatBytes(context.freeBytes)} livres na unidade de destino.
          </p>
        ) : null}

        {state.draft.scope === 'machine' ? (
          <p className="mt-4 flex items-center gap-2 text-[12px] text-foreground-muted">
            <ShieldCheck className="size-3.5 text-warning" />
            A pasta em Program Files exige administrador.
          </p>
        ) : null}
      </div>

      <Footer hint="Seus dados de conversas ficam separados da pasta do aplicativo.">
        <Button variant="ghost" onClick={onBack} leftIcon={<ChevronLeft className="size-4" />}>
          Voltar
        </Button>
        <Button variant="primary" disabled={Boolean(problem)} onClick={onContinue} rightIcon={<ArrowRight className="size-4" />}>
          Continuar
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
  return (
    <>
      <ScreenHeader
        eyebrow={update ? 'Atualização' : 'Etapa 3 de 3'}
        title={update ? 'Confirme a atualização' : 'Ajuste os detalhes'}
        description={
          update
            ? `O Zylara ${context.version} será instalado sobre a versão ${context.existing?.version}. Seus dados serão preservados.`
            : 'Escolha como o Zylara deve aparecer no Windows. Você pode mudar os atalhos depois na pasta de instalação.'
        }
      />

      {context.conflicting ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="text-[12.5px] leading-relaxed text-foreground-muted">
            <p className="font-medium text-danger">Existe outra instalação do Zylara.</p>
            <p className="mt-0.5">
              {scopeLabel(context.conflicting.scope)} em {context.conflicting.path} (v
              {context.conflicting.version}). Remova essa instalação antes de continuar.
            </p>
          </div>
        </div>
      ) : null}

      {context.appRunning ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-foreground">O Zylara está aberto</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">
              Feche o aplicativo antes de continuar para evitar arquivos bloqueados.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void onCloseApp()}>
            Fechar agora
          </Button>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <OptionRow
          checked={state.draft.desktopShortcut}
          onChange={(value) => onOption('desktopShortcut', value)}
          title="Atalho na área de trabalho"
          description="Cria um atalho para abrir o Zylara."
        />
        <OptionRow
          checked={state.draft.startMenuShortcut}
          onChange={(value) => onOption('startMenuShortcut', value)}
          title="Atalho no Menu Iniciar"
          description="Adiciona o Zylara ao menu Iniciar e à pesquisa do Windows."
        />
        <OptionRow
          checked={state.draft.launchAfterInstall}
          onChange={(value) => onOption('launchAfterInstall', value)}
          title="Abrir o Zylara ao concluir"
          description="Inicia o aplicativo assim que a instalação terminar."
        />
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex items-start gap-2.5">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
          <div className="text-[12px] leading-relaxed text-foreground-muted">
            <p>
              <span className="font-medium text-foreground">Destino:</span> {state.draft.path}
            </p>
            <p className="mt-0.5">
              <span className="font-medium text-foreground">Escopo:</span> {scopeLabel(state.draft.scope)}
            </p>
          </div>
        </div>
      </div>

      <Footer
        hint={
          state.draft.scope === 'machine' && !context.isAdmin
            ? 'Ao instalar, o Windows pedirá permissão de administrador.'
            : 'A instalação não remove nem altera suas conversas existentes.'
        }
      >
        <Button variant="ghost" onClick={onBack} leftIcon={<ChevronLeft className="size-4" />}>
          Voltar
        </Button>
        <Button
          variant="primary"
          onClick={onInstall}
          disabled={Boolean(context.conflicting)}
          leftIcon={<Download className="size-4" />}
        >
          {update ? 'Atualizar agora' : 'Instalar Zylara'}
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
  return (
    <>
      <ScreenHeader
        eyebrow={state.mode === 'uninstall' ? 'Removendo' : 'Instalando'}
        title={state.mode === 'uninstall' ? 'Removendo o Zylara' : 'Instalando o Zylara'}
        description="Mantenha esta janela aberta. O instalador está aplicando as alterações com segurança."
      />

      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-foreground" aria-live="polite">
            {state.progressMessage || 'Preparando…'}
          </p>
          <Badge variant="outline" size="md">
            {done}/{state.steps.length}
          </Badge>
        </div>
        <ProgressBar
          className="mt-3"
          size="md"
          value={state.progress}
          label={state.mode === 'uninstall' ? 'Progresso da desinstalação' : 'Progresso da instalação'}
        />

        <ol className="mt-5 space-y-2.5">
          {state.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                  step.status === 'done' && 'border-success/40 bg-success-soft text-success',
                  step.status === 'running' && 'border-accent/40 bg-accent-soft text-accent',
                  step.status === 'error' && 'border-danger/40 bg-danger-soft text-danger',
                  step.status === 'skipped' && 'border-border bg-surface text-foreground-subtle',
                  step.status === 'pending' && 'border-border bg-surface text-foreground-subtle',
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

        <details className="group mt-5 rounded-lg border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[12px] font-medium text-foreground-muted hover:text-foreground">
            <span className="flex items-center gap-2">
              <FileText className="size-3.5" />
              Detalhes da instalação
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
                Abrir log
              </button>
              <ArrowRight className="size-3.5 transition-transform group-open:rotate-90" />
            </span>
          </summary>
          <pre className="max-h-40 overflow-auto border-t border-border px-3.5 py-2.5 font-mono text-[10.5px] leading-relaxed text-foreground-subtle">
            {state.logLines.length ? state.logLines.join('\n') : 'Sem detalhes ainda.'}
          </pre>
        </details>
      </div>

      <Footer hint="Você pode cancelar antes de a cópia dos arquivos começar.">
        <Button variant="ghost" onClick={onCancel} loading={state.cancelling} disabled={state.progress >= 30}>
          Cancelar
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
  return (
    <>
      <div className="flex flex-col items-center py-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
          <Check className="size-8" strokeWidth={2.2} />
        </div>
        <h1 className="mt-5 text-[24px] font-semibold tracking-tight">
          {uninstall ? 'Zylara removido' : launched ? 'Tudo pronto' : 'Instalação concluída'}
        </h1>
        <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-foreground-muted">
          {uninstall
            ? state.draft.purgeData
              ? 'O aplicativo e os dados do usuário foram removidos deste computador.'
              : 'O aplicativo foi removido. Suas conversas, arquivos e configurações foram preservados.'
            : launched
              ? 'O Zylara foi instalado e já está aberto. Bom trabalho!'
              : 'O Zylara está pronto para usar. Você pode abri-lo agora ou pela área de trabalho.'}
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
            {launched ? 'Abrir Zylara' : 'Abrir Zylara agora'}
          </Button>
        ) : null}
        {!uninstall ? (
          <Button variant="secondary" onClick={() => void onOpenFolder()} leftIcon={<FolderOpen className="size-4" />}>
            Abrir pasta
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
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
  return (
    <>
      <ScreenHeader
        eyebrow="Desinstalação"
        title="Remover o Zylara?"
        description="O aplicativo será removido deste computador. Você pode escolher se as conversas, arquivos e configurações também devem ser apagados."
      />

      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Zylara {context.existing?.version ?? context.version}</p>
            <p className="mt-1 break-all text-[12px] text-foreground-muted">{context.existing?.path ?? state.draft.path}</p>
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
          label="Remover também meus dados"
          description="Apaga conversas, anexos, artefatos, configurações e chaves de API salvas neste computador. Esta ação não pode ser desfeita."
        />
        {state.draft.purgeData ? (
          <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <p className="text-[12px] leading-relaxed text-foreground-muted">
              As chaves de API serão apagadas. Você precisará configurá-las novamente se reinstalar o Zylara.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-[12px] leading-relaxed text-foreground-muted">
        {state.draft.purgeData
          ? confirming
            ? 'Confirme novamente para apagar o aplicativo e todos os dados do usuário atual. Esta ação é definitiva.'
            : 'No próximo passo você confirma a remoção dos dados. Seus arquivos ainda estão protegidos até lá.'
          : 'Suas conversas, arquivos e configurações serão mantidos por padrão.'}
      </div>

      <Footer hint="A remoção do aplicativo não afeta outras contas deste computador.">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
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
          {state.draft.purgeData && confirming ? 'Confirmar remoção' : 'Remover Zylara'}
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
  return (
    <>
      <ScreenHeader
        eyebrow="Algo deu errado"
        title={state.mode === 'uninstall' ? 'Não foi possível remover' : 'Não foi possível instalar'}
        description="A operação foi interrompida. Veja os detalhes abaixo e tente novamente."
      />

      <div className="rounded-2xl border border-danger/30 bg-danger-soft p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">O instalador encontrou um problema</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground-muted">
              {state.error ?? 'Erro desconhecido.'}
            </p>
          </div>
        </div>
      </div>

      {state.outcome?.logPath || state.logLines.length ? (
        <details className="mt-4 rounded-xl border border-border bg-surface-raised">
          <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-medium text-foreground-muted hover:text-foreground">
            Detalhes técnicos
          </summary>
          <pre className="max-h-48 overflow-auto border-t border-border px-4 py-3 font-mono text-[10.5px] leading-relaxed text-foreground-subtle">
            {state.logLines.join('\n') || 'Consulte o log completo.'}
          </pre>
        </details>
      ) : null}

      <Footer hint="O log completo fica na pasta temporária do Windows.">
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        <Button variant="secondary" onClick={onOpenLog} leftIcon={<ExternalLink className="size-4" />}>
          Abrir log
        </Button>
        <Button variant="primary" onClick={onRetry} leftIcon={<RotateCcw className="size-4" />}>
          Tentar novamente
        </Button>
      </Footer>
    </>
  );
}
