// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Artifact, ArtifactContent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getArtifactPreview: vi.fn(),
  saveArtifact: vi.fn(),
  openArtifact: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getArtifactPreview: mocks.getArtifactPreview,
    saveArtifact: mocks.saveArtifact,
    openArtifact: mocks.openArtifact,
  },
}));

// Imported after the mocks above.
import { ImagePreview, imageFormatLabel, SvgPreview } from '@/components/artifacts/ImagePreview';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('/tmp/arquivo');
  mocks.openArtifact.mockResolvedValue(undefined);
});

function imageArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-image',
    conversationId: 'conv-1',
    name: 'grafico.png',
    mimeType: 'image/png',
    kind: 'image',
    size: 5120,
    createdAt: 1,
    ...overrides,
  };
}

function imageContent(overrides: Partial<ArtifactContent> = {}): ArtifactContent {
  return { artifact: imageArtifact(), content: null, dataBase64: null, ...overrides };
}

function svgContent(markup: string): ArtifactContent {
  return {
    artifact: {
      id: 'artifact-svg',
      conversationId: 'conv-1',
      name: 'diagrama.svg',
      mimeType: 'image/svg+xml',
      kind: 'svg',
      size: 1024,
      createdAt: 1,
    },
    content: markup,
    dataBase64: null,
  };
}

describe('ImagePreview — imagem', () => {
  it('usa o payload do conteúdo para formatos web-safe', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'image',
      mime: 'image/png',
      width: 1280,
      height: 720,
    });

    render(<ImagePreview content={imageContent({ dataBase64: 'aGVsbG8=' })} />);

    const image = (await screen.findByRole('img', { name: 'grafico.png' })) as HTMLImageElement;
    expect(image.src).toBe('data:image/png;base64,aGVsbG8=');
    expect(screen.getByRole('toolbar', { name: 'Controles da imagem' })).toBeTruthy();
    expect(screen.getByText('PNG')).toBeTruthy();
    expect(screen.getByText('1280 × 720')).toBeTruthy();
  });

  it('dá prioridade ao payload convertido da prévia (TIFF → PNG)', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'image',
      mime: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
      width: 800,
      height: 600,
    });

    render(
      <ImagePreview
        content={imageContent({
          artifact: imageArtifact({ name: 'digitalizado.tif', mimeType: 'image/tiff' }),
        })}
      />,
    );

    const image = (await screen.findByRole('img', { name: 'digitalizado.tif' })) as HTMLImageElement;
    expect(image.src).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByText('PNG')).toBeTruthy();
    expect(screen.getByText('800 × 600')).toBeTruthy();
  });

  it('mostra loading enquanto a prévia não responde e não há payload', () => {
    mocks.getArtifactPreview.mockReturnValue(new Promise(() => undefined));

    render(
      <ImagePreview
        content={imageContent({
          artifact: imageArtifact({ name: 'digitalizado.tif', mimeType: 'image/tiff' }),
        })}
      />,
    );

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getAllByText('Carregando imagem…').length).toBeGreaterThan(0);
  });

  it('controla zoom, ajuste à janela e tamanho real', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'image',
      mime: 'image/png',
      width: 1280,
      height: 720,
    });

    render(<ImagePreview content={imageContent({ dataBase64: 'aGVsbG8=' })} />);

    const image = (await screen.findByRole('img', { name: 'grafico.png' })) as HTMLImageElement;
    const fitButton = screen.getByRole('button', { name: 'Ajustar à janela' });
    const actualButton = screen.getByRole('button', { name: 'Tamanho real' });

    expect(fitButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('100%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    expect(screen.getByText('125%')).toBeTruthy();
    expect(image.style.transform).toContain('scale(1.25)');

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    expect(screen.getByText('150%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    expect(screen.getByText('125%')).toBeTruthy();

    fireEvent.click(fitButton);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(fitButton.getAttribute('aria-pressed')).toBe('true');
    expect(image.style.transform).toBe('');

    fireEvent.click(actualButton);
    expect(actualButton.getAttribute('aria-pressed')).toBe('true');
    expect(image.className).toContain('max-w-none');
  });

  it('limita o zoom entre 25% e 800%', async () => {
    mocks.getArtifactPreview.mockResolvedValue({ kind: 'image', mime: 'image/png' });

    render(<ImagePreview content={imageContent({ dataBase64: 'aGVsbG8=' })} />);
    await screen.findByRole('img', { name: 'grafico.png' });

    const zoomOut = screen.getByRole('button', { name: 'Diminuir zoom' }) as HTMLButtonElement;
    const zoomIn = screen.getByRole('button', { name: 'Aumentar zoom' }) as HTMLButtonElement;

    for (let index = 0; index < 6; index += 1) fireEvent.click(zoomOut);
    expect(screen.getByText('25%')).toBeTruthy();
    expect(zoomOut.disabled).toBe(true);

    for (let index = 0; index < 40; index += 1) fireEvent.click(zoomIn);
    expect(screen.getByText('800%')).toBeTruthy();
    expect(zoomIn.disabled).toBe(true);
  });

  it('aplica atalhos +/−/0/1 no palco', async () => {
    mocks.getArtifactPreview.mockResolvedValue({ kind: 'image', mime: 'image/png' });

    render(<ImagePreview content={imageContent({ dataBase64: 'aGVsbG8=' })} />);
    await screen.findByRole('img', { name: 'grafico.png' });

    const stage = screen.getByRole('region', { name: 'Visualização da imagem' });
    expect(stage.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(stage, { key: '+' });
    expect(screen.getByText('125%')).toBeTruthy();

    fireEvent.keyDown(stage, { key: '0' });
    expect(screen.getByText('100%')).toBeTruthy();

    fireEvent.keyDown(stage, { key: '1' });
    expect(screen.getByRole('button', { name: 'Tamanho real' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('usa as dimensões naturais quando a prévia não informa', async () => {
    mocks.getArtifactPreview.mockResolvedValue({ kind: 'image', mime: 'image/png' });

    render(<ImagePreview content={imageContent({ dataBase64: 'aGVsbG8=' })} />);
    const image = (await screen.findByRole('img', { name: 'grafico.png' })) as HTMLImageElement;

    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 480 });
    fireEvent.load(image);

    expect(await screen.findByText('640 × 480')).toBeTruthy();
  });

  it('cai no cartão binário quando a prévia é unsupported e não há payload', async () => {
    mocks.getArtifactPreview.mockResolvedValue({
      kind: 'unsupported',
      reason: 'Formato HEIC não é exibido no aplicativo; use Salvar/Abrir.',
    });

    render(
      <ImagePreview
        content={imageContent({
          artifact: imageArtifact({ name: 'foto.heic', mimeType: 'image/heic' }),
        })}
      />,
    );

    expect(
      await screen.findByText('Formato HEIC não é exibido no aplicativo; use Salvar/Abrir.'),
    ).toBeTruthy();
    expect(screen.getByText(/prévia não disponível/)).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Controles da imagem' })).toBeNull();
  });

  it('cai no cartão binário quando a imagem não decodifica', async () => {
    mocks.getArtifactPreview.mockResolvedValue({ kind: 'image', mime: 'image/png' });

    render(<ImagePreview content={imageContent({ dataBase64: 'aGVsbG8=' })} />);
    const image = await screen.findByRole('img', { name: 'grafico.png' });

    fireEvent.error(image);

    expect(await screen.findByText('Não foi possível decodificar a imagem.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('mantém o cartão com retry quando a prévia falha e não há payload', async () => {
    mocks.getArtifactPreview.mockRejectedValue(new Error('Prévia indisponível'));

    render(
      <ImagePreview
        content={imageContent({
          artifact: imageArtifact({ name: 'digitalizado.tif', mimeType: 'image/tiff' }),
        })}
      />,
    );

    expect(await screen.findByText('Prévia indisponível')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});

describe('ImagePreview — formatação', () => {
  it('mapeia mime/extensão para o rótulo do badge', () => {
    expect(imageFormatLabel('image/png', 'a.png')).toBe('PNG');
    expect(imageFormatLabel('image/jpeg', 'a.jpg')).toBe('JPEG');
    expect(imageFormatLabel('image/webp', 'a.webp')).toBe('WEBP');
    expect(imageFormatLabel('image/gif', 'a.gif')).toBe('GIF');
    expect(imageFormatLabel('image/avif', 'a.avif')).toBe('AVIF');
    expect(imageFormatLabel('image/bmp', 'a.bmp')).toBe('BMP');
    expect(imageFormatLabel('image/x-icon', 'a.ico')).toBe('ICO');
    expect(imageFormatLabel('image/tiff', 'a.tif')).toBe('TIFF');
    expect(imageFormatLabel('application/octet-stream', 'scan.tif')).toBe('TIFF');
    expect(imageFormatLabel(null, 'sem-extensao')).toBe('IMG');
  });
});

describe('SvgPreview', () => {
  it('sanitiza o SVG antes de injetar no palco', () => {
    const { container } = render(
      <SvgPreview
        content={svgContent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">' +
            '<script>alert(1)</script><rect width="10" height="10" onload="alert(2)" /></svg>',
        )}
      />,
    );

    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onload]')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Controles do SVG' })).toBeTruthy();
    expect(screen.getByText('120 × 80')).toBeTruthy();
    expect(mocks.getArtifactPreview).not.toHaveBeenCalled();
  });

  it('permite zoom no SVG sanitizado', () => {
    render(<SvgPreview content={svgContent('<svg viewBox="0 0 10 10"><rect /><rect /></svg>')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    expect(screen.getByText('125%')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('region', { name: 'Visualização do SVG' }), { key: '0' });
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajustar à janela' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('mostra o markup como texto quando não é SVG', () => {
    render(<SvgPreview content={svgContent('<p>apenas texto, sem svg</p>')} />);

    expect(screen.getByText(/Markup não reconhecido como SVG/)).toBeTruthy();
    expect(screen.getByText('<p>apenas texto, sem svg</p>')).toBeTruthy();
  });

  it('mostra o próprio texto quando o conteúdo é vazio', () => {
    render(<SvgPreview content={svgContent('')} />);

    expect(screen.getByText(/Markup não reconhecido como SVG/)).toBeTruthy();
  });
});
