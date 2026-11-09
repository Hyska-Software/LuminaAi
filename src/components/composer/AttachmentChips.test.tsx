// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttachmentInfo } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getAttachmentThumbnail: vi.fn(),
  getAttachmentContent: vi.fn(),
  getAttachmentPreview: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getAttachmentThumbnail: mocks.getAttachmentThumbnail,
    getAttachmentContent: mocks.getAttachmentContent,
    getAttachmentPreview: mocks.getAttachmentPreview,
  },
}));

// Imported after the mocks above.
import { AttachmentChips } from './AttachmentChips';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAttachmentThumbnail.mockResolvedValue(null);
  mocks.getAttachmentContent.mockResolvedValue(null);
  mocks.getAttachmentPreview.mockResolvedValue(null);
});

function attachment(overrides: Partial<AttachmentInfo> = {}): AttachmentInfo {
  return {
    id: 'att-1',
    name: 'relatorio.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    kind: 'pdf',
    ...overrides,
  };
}

describe('AttachmentChips — tipo explícito e prévia', () => {
  it('mostra o formato na linha secundária e não pede miniatura para não-imagens', () => {
    const { container } = render(<AttachmentChips attachments={[attachment()]} />);

    expect(screen.getByText('relatorio.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 2 KB')).toBeTruthy();
    expect(mocks.getAttachmentThumbnail).not.toHaveBeenCalled();
    expect(container.querySelector('[data-file-icon="pdf"]')).toBeTruthy();
  });

  it('usa os ícones coloridos do file explorer para arquivos de código variados', () => {
    const files = [
      attachment({ id: 'att-ts', name: 'main.ts', mimeType: 'text/typescript', kind: 'code', size: 512 }),
      attachment({ id: 'att-rs', name: 'lib.rs', mimeType: 'text/rust', kind: 'code', size: 512 }),
      attachment({ id: 'att-css', name: 'styles.css', mimeType: 'text/css', kind: 'code', size: 512 }),
    ];

    const { container } = render(<AttachmentChips attachments={files} />);

    const icons = Array.from(container.querySelectorAll('[data-file-icon]')).map((node) =>
      node.getAttribute('data-file-icon'),
    );
    expect(icons).toEqual(['typescript', 'rust', 'css']);
  });

  it('renderiza a miniatura de imagens na tile do chip', async () => {
    mocks.getAttachmentThumbnail.mockResolvedValue({
      mime: 'image/png',
      dataBase64: 'AAAA',
      width: 40,
      height: 40,
    });
    const image = attachment({
      id: 'att-img',
      name: 'grafico.png',
      mimeType: 'image/png',
      kind: 'image',
      width: 675,
      height: 265,
    });

    const { container } = render(<AttachmentChips attachments={[image]} />);

    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,AAAA',
      ),
    );
    expect(screen.getByText('PNG · 675×265 · 2 KB')).toBeTruthy();
    expect(mocks.getAttachmentThumbnail).toHaveBeenCalledWith('att-img');
  });

  it('abre o diálogo de prévia ao clicar no chip', async () => {
    const text = attachment({
      id: 'att-text',
      name: 'nota.txt',
      mimeType: 'text/plain',
      kind: 'text',
      size: 1024,
    });
    mocks.getAttachmentContent.mockResolvedValue({ attachment: text, content: 'ola mundo' });

    render(<AttachmentChips attachments={[text]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia de nota.txt' }));

    expect(await screen.findByText('ola mundo')).toBeTruthy();
    expect(mocks.getAttachmentContent).toHaveBeenCalledWith('att-text');
    expect(screen.getAllByText('nota.txt').length).toBeGreaterThan(0);
  });

  it('remove o anexo sem abrir a prévia', () => {
    const onRemove = vi.fn();
    render(<AttachmentChips attachments={[attachment()]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remover relatorio.pdf' }));

    expect(onRemove).toHaveBeenCalledWith('att-1');
    expect(mocks.getAttachmentContent).not.toHaveBeenCalled();
  });
});
