// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AttachmentInfo } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getAttachmentContent: vi.fn(),
  getAttachmentPreview: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getAttachmentContent: mocks.getAttachmentContent,
    getAttachmentPreview: mocks.getAttachmentPreview,
  },
}));

// Imported after the mocks above.
import { AttachmentPreviewDialog } from './AttachmentPreviewDialog';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAttachmentPreview.mockResolvedValue(null);
});

function textAttachment(): AttachmentInfo {
  return {
    id: 'att-text',
    name: 'nota.txt',
    mimeType: 'text/plain',
    size: 1024,
    kind: 'text',
  };
}

describe('AttachmentPreviewDialog', () => {
  it('carrega o conteúdo textual e mostra nome, tipo e payload', async () => {
    const attachment = textAttachment();
    mocks.getAttachmentContent.mockResolvedValue({ attachment, content: 'ola mundo' });

    render(<AttachmentPreviewDialog attachment={attachment} onClose={() => undefined} />);

    expect(await screen.findByText('ola mundo')).toBeTruthy();
    expect(mocks.getAttachmentContent).toHaveBeenCalledWith('att-text');
    expect(screen.getAllByText('nota.txt').length).toBeGreaterThan(0);
    expect(screen.getByText('TXT')).toBeTruthy();
    expect(screen.getByText('1 KB')).toBeTruthy();
  });

  it('mostra o erro e tenta de novo ao clicar em Tentar novamente', async () => {
    const attachment = textAttachment();
    mocks.getAttachmentContent.mockRejectedValueOnce(new Error('falha de leitura'));

    render(<AttachmentPreviewDialog attachment={attachment} onClose={() => undefined} />);

    expect(await screen.findByText('Não foi possível carregar a prévia')).toBeTruthy();
    expect(screen.getByText('falha de leitura')).toBeTruthy();

    mocks.getAttachmentContent.mockResolvedValueOnce({ attachment, content: 'conteudo novo' });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('conteudo novo')).toBeTruthy();
    expect(mocks.getAttachmentContent).toHaveBeenCalledTimes(2);
  });
});
