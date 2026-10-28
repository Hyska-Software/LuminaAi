// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkspaceFileContent } from '@/lib/types';

const utilsMocks = vi.hoisted(() => ({ copyText: vi.fn(async () => true) }));
const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, copyText: utilsMocks.copyText };
});
vi.mock('sonner', () => ({ toast: toastMocks }));

import { FilePreview, languageForPath } from './FilePreview';

function content(overrides: Partial<WorkspaceFileContent> = {}): WorkspaceFileContent {
  return {
    path: 'src/app.ts',
    text: 'const total = 1;\nexport default total;\n',
    truncated: false,
    size: 48,
    ...overrides,
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  utilsMocks.copyText.mockResolvedValue(true);
});

describe('FilePreview', () => {
  it('renders the highlighted source with line numbers and the language badge', () => {
    render(<FilePreview content={content()} />);
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('TypeScript')).toBeTruthy();
    const pre = screen.getByLabelText('Conteúdo de src/app.ts');
    expect(pre).toBeTruthy();
    // One rendered row per source line (line numbers are in the gutter).
    expect(pre.querySelectorAll(':scope > div').length).toBe(3);
    expect(pre.textContent).toContain('export default total');
    expect(screen.getByText(/3 linhas/)).toBeTruthy();
  });

  it('shows the file-type icon before the path in the header', () => {
    render(<FilePreview content={content()} />);
    const pathLabel = screen.getByText('src/app.ts');
    expect(pathLabel.previousElementSibling?.getAttribute('data-file-icon')).toBe('typescript');
  });

  it('uses the type icon in the binary preview header', () => {
    render(<FilePreview content={content({ path: 'docs/doc.pdf', binary: true, text: '', size: 2048 })} />);
    const pathLabel = screen.getByText('docs/doc.pdf');
    expect(pathLabel.previousElementSibling?.getAttribute('data-file-icon')).toBe('pdf');
  });

  it('copies the path and gives feedback', async () => {
    render(<FilePreview content={content()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar caminho' }));
    expect(utilsMocks.copyText).toHaveBeenCalledWith('src/app.ts');
    expect(await screen.findByRole('button', { name: 'Caminho copiado' })).toBeTruthy();
  });

  it('calls onOpenExternal with the file path', () => {
    const onOpenExternal = vi.fn();
    render(<FilePreview content={content()} onOpenExternal={onOpenExternal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no editor externo' }));
    expect(onOpenExternal).toHaveBeenCalledWith('src/app.ts');
  });

  it('shows truncated and non-UTF-8 warnings', () => {
    render(
      <FilePreview content={content({ truncated: true, encoding: 'windows-1252', size: 900_000 })} />,
    );
    expect(screen.getAllByRole('note').length).toBe(2);
    expect(screen.getByText(/Prévia truncada/)).toBeTruthy();
    expect(screen.getByText(/Encoding windows-1252/)).toBeTruthy();
  });

  it('renders a binary card without text content', () => {
    render(<FilePreview content={content({ binary: true, text: '', size: 2048 })} />);
    expect(screen.getByText('Arquivo binário')).toBeTruthy();
    expect(screen.queryByLabelText('Conteúdo de src/app.ts')).toBeNull();
  });

  it('renders loading and error states', () => {
    const { unmount } = render(<FilePreview loading />);
    expect(screen.getByRole('status', { name: 'Carregando arquivo' })).toBeTruthy();
    unmount();

    render(<FilePreview error="Arquivo não encontrado." />);
    expect(screen.getByText('Não foi possível abrir o arquivo')).toBeTruthy();
    expect(screen.getByText('Arquivo não encontrado.')).toBeTruthy();
  });

  it('renders the empty selection state', () => {
    render(<FilePreview />);
    expect(screen.getByText('Nenhum arquivo selecionado')).toBeTruthy();
  });

  it('renders the empty file state', () => {
    render(<FilePreview content={content({ text: '' })} />);
    expect(screen.getByText('Arquivo vazio.')).toBeTruthy();
  });
});

describe('languageForPath', () => {
  it('maps extensions and special file names to Prism ids', () => {
    expect(languageForPath('src/app.ts')).toBe('typescript');
    expect(languageForPath('scripts/run.ps1')).toBe('powershell');
    expect(languageForPath('Dockerfile')).toBe('docker');
    expect(languageForPath('.env.local')).toBe('ini');
    expect(languageForPath('LICENSE')).toBe('text');
  });
});
