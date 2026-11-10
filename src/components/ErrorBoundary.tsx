import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { i18n, t } from '@/lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches renderer crashes and offers a way back without losing the window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidMount() {
    // Class components do not re-render on language changes by themselves.
    i18n.on('languageChanged', this.handleLanguageChange);
  }

  componentWillUnmount() {
    i18n.off('languageChanged', this.handleLanguageChange);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed', error, info.componentStack);
  }

  private handleLanguageChange = () => {
    if (this.state.error) this.forceUpdate();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-6 shadow-lg">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger">
            <AlertTriangle className="size-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{t('common:errors.boundaryTitle')}</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            {t('common:errors.boundaryDescription')}
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-surface p-3 text-xs text-foreground-muted">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              <RotateCcw className="size-4" />
              {t('common:errors.reload')}
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover"
            >
              {t('common:actions.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
