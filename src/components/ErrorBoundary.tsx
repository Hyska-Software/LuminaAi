import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

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

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-6 shadow-lg">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger">
            <AlertTriangle className="size-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Algo quebrou por aqui</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            A interface encontrou um erro inesperado. Você pode recarregar a janela — suas conversas
            estão salvas localmente.
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
              Recarregar
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }
}
