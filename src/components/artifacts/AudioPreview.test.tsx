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
import { AudioPreview, mediaDurationLabel, mediaFormatLabel } from '@/components/artifacts/AudioPreview';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('/tmp/trilha.mp3');
  mocks.openArtifact.mockResolvedValue(undefined);
});

function audioArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-audio',
    conversationId: 'conv-1',
    name: 'trilha.mp3',
    mimeType: 'audio/mpeg',
    kind: 'audio',
    size: 524_288,
    createdAt: 1,
    ...overrides,
  };
}

function audioContent(overrides: Partial<ArtifactContent> = {}): ArtifactContent {
  return { artifact: audioArtifact(), content: null, dataBase64: null, ...overrides };
}

describe('AudioPreview', () => {
  it('renderiza o player nativo com data URI e metadados', () => {
    render(<AudioPreview content={audioContent({ dataBase64: 'SUQzBA==' })} />);

    const player = screen.getByLabelText('Reprodutor de áudio de trilha.mp3') as HTMLAudioElement;
    expect(player.tagName).toBe('AUDIO');
    expect(player.controls).toBe(true);
    expect(player.getAttribute('src')).toBe('data:audio/mpeg;base64,SUQzBA==');

    expect(screen.getByText('MP3')).toBeTruthy();
    expect(screen.getByText('512 KB')).toBeTruthy();
    expect(screen.getByText('Duração —')).toBeTruthy();
  });

  it('mostra a duração após loadedmetadata', () => {
    render(<AudioPreview content={audioContent({ dataBase64: 'SUQzBA==' })} />);

    const player = screen.getByLabelText('Reprodutor de áudio de trilha.mp3') as HTMLAudioElement;
    Object.defineProperty(player, 'duration', { configurable: true, value: 75 });
    fireEvent(player, new Event('loadedmetadata'));

    expect(screen.getByText('1:15')).toBeTruthy();
  });

  it('usa a extensão quando o mime não é de áudio', () => {
    render(
      <AudioPreview
        content={audioContent({
          artifact: audioArtifact({ name: 'voz.wav', mimeType: 'application/octet-stream' }),
          dataBase64: 'UklGRg==',
        })}
      />,
    );

    const player = screen.getByLabelText('Reprodutor de áudio de voz.wav') as HTMLAudioElement;
    expect(player.getAttribute('src')).toBe('data:audio/wav;base64,UklGRg==');
    expect(screen.getByText('WAV')).toBeTruthy();
  });

  it('cai no cartão quando o backend não envia payload (arquivo grande)', () => {
    render(<AudioPreview content={audioContent()} />);

    expect(screen.getByText(/grande demais para reprodução inline/)).toBeTruthy();
    expect(screen.getByText(/use Abrir\/Salvar/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar como…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeTruthy();
    expect(mocks.getArtifactPreview).not.toHaveBeenCalled();
  });

  it('cai no cartão com motivo quando o media falha', () => {
    render(<AudioPreview content={audioContent({ dataBase64: 'SUQzBA==' })} />);

    fireEvent.error(screen.getByLabelText('Reprodutor de áudio de trilha.mp3'));

    expect(screen.getByText(/Não foi possível reproduzir o áudio/)).toBeTruthy();
  });
});

describe('AudioPreview — helpers', () => {
  it('formata a duração em m:ss e h:mm:ss', () => {
    expect(mediaDurationLabel(75)).toBe('1:15');
    expect(mediaDurationLabel(0)).toBe('0:00');
    expect(mediaDurationLabel(3723)).toBe('1:02:03');
    expect(mediaDurationLabel(null)).toBeNull();
    expect(mediaDurationLabel(Number.NaN)).toBeNull();
    expect(mediaDurationLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rotula formatos por extensão/mime', () => {
    const table = {
      byExt: { mp3: 'MP3', wav: 'WAV', ogg: 'OGG' },
      byMime: { 'audio/mpeg': 'MP3', 'audio/ogg': 'OGG' },
    };
    expect(mediaFormatLabel('audio/mpeg', 'trilha.mp3', table, 'ÁUDIO')).toBe('MP3');
    expect(mediaFormatLabel('application/octet-stream', 'voz.wav', table, 'ÁUDIO')).toBe('WAV');
    expect(mediaFormatLabel(null, null, table, 'ÁUDIO')).toBe('ÁUDIO');
  });
});
