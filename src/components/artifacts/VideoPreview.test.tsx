// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { VideoPreview } from '@/components/artifacts/VideoPreview';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('/tmp/demo.mp4');
  mocks.openArtifact.mockResolvedValue(undefined);
});

function videoArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-video',
    conversationId: 'conv-1',
    name: 'demo.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    size: 1_048_576,
    createdAt: 1,
    ...overrides,
  };
}

function videoContent(overrides: Partial<ArtifactContent> = {}): ArtifactContent {
  return { artifact: videoArtifact(), content: null, dataBase64: null, ...overrides };
}

describe('VideoPreview', () => {
  it('renderiza o player nativo com data URI, playsInline e metadados', () => {
    render(<VideoPreview content={videoContent({ dataBase64: 'AAAAIGZ0eXBtcDQy' })} />);

    const player = screen.getByLabelText('Reprodutor de vídeo de demo.mp4') as HTMLVideoElement;
    expect(player.tagName).toBe('VIDEO');
    expect(player.controls).toBe(true);
    expect(player.hasAttribute('playsinline') || player.playsInline).toBe(true);
    expect(player.getAttribute('src')).toBe('data:video/mp4;base64,AAAAIGZ0eXBtcDQy');
    expect(player.className).toContain('max-h-full');
    expect(player.className).toContain('max-w-full');

    expect(screen.getByText('MP4')).toBeTruthy();
    expect(screen.getByText('1 MB')).toBeTruthy();
    expect(screen.getByText('Duração —')).toBeTruthy();
  });

  it('mostra a duração após loadedmetadata', () => {
    render(<VideoPreview content={videoContent({ dataBase64: 'AAAAIGZ0eXBtcDQy' })} />);

    const player = screen.getByLabelText('Reprodutor de vídeo de demo.mp4') as HTMLVideoElement;
    Object.defineProperty(player, 'duration', { configurable: true, value: 125 });
    fireEvent(player, new Event('loadedmetadata'));

    expect(screen.getByText('2:05')).toBeTruthy();
  });

  it('usa a extensão quando o mime não é de vídeo', () => {
    render(
      <VideoPreview
        content={videoContent({
          artifact: videoArtifact({ name: 'captura.webm', mimeType: 'application/octet-stream' }),
          dataBase64: 'GkXfow==',
        })}
      />,
    );

    const player = screen.getByLabelText('Reprodutor de vídeo de captura.webm') as HTMLVideoElement;
    expect(player.getAttribute('src')).toBe('data:video/webm;base64,GkXfow==');
    expect(screen.getByText('WEBM')).toBeTruthy();
  });

  it('cai no cartão quando o backend não envia payload (arquivo grande)', () => {
    render(<VideoPreview content={videoContent()} />);

    expect(screen.getByText(/grande demais para reprodução inline/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar como…' })).toBeTruthy();
    expect(mocks.getArtifactPreview).not.toHaveBeenCalled();
  });

  it('cai no cartão com motivo quando o media falha', () => {
    render(<VideoPreview content={videoContent({ dataBase64: 'AAAAIGZ0eXBtcDQy' })} />);

    fireEvent.error(screen.getByLabelText('Reprodutor de vídeo de demo.mp4'));

    expect(screen.getByText(/Não foi possível reproduzir o vídeo/)).toBeTruthy();
  });
});
