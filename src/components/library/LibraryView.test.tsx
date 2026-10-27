// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ArtifactContent, LibraryArtifact } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listLibraryArtifacts: vi.fn(),
  importLibraryFiles: vi.fn(),
  renameArtifact: vi.fn(),
  setArtifactFavorite: vi.fn(),
  getArtifactThumbnail: vi.fn(),
  getArtifactContent: vi.fn(),
  getArtifactPreview: vi.fn(),
  saveArtifact: vi.fn(),
  openArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
}));

const dialogMocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialogMocks.open }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { LibraryView } from '@/components/library';
import { useUiStore } from '@/lib/store';

const BASE_TIME = Date.UTC(2026, 9, 20, 12);

function artifact(overrides: Partial<LibraryArtifact> = {}): LibraryArtifact {
  return {
    id: 'art-base',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    name: 'arquivo.bin',
    mimeType: 'application/octet-stream',
    kind: 'binary',
    language: null,
    size: 1024,
    createdAt: BASE_TIME,
    favorite: false,
    conversationTitle: 'Projeto Aurora',
    ...overrides,
  };
}

/** Eight artifacts covering every category, spread across conversations/uploads. */
function libraryFixture(): LibraryArtifact[] {
  return [
    artifact({
      id: 'art-md-2',
      name: 'notas.md',
      mimeType: 'text/markdown',
      kind: 'markdown',
      language: 'markdown',
      size: 100,
      createdAt: BASE_TIME + 6,
      conversationTitle: 'Projeto Aurora',
    }),
    artifact({
      id: 'art-md-1',
      name: 'resumo.md',
      mimeType: 'text/markdown',
      kind: 'markdown',
      language: 'markdown',
      size: 900,
      createdAt: BASE_TIME + 5,
      conversationTitle: 'Reunião de segunda',
    }),
    artifact({
      id: 'art-pdf',
      name: 'relatorio.pdf',
      mimeType: 'application/pdf',
      kind: 'pdf',
      size: 5000,
      createdAt: BASE_TIME + 4,
      conversationTitle: 'Projeto Aurora',
    }),
    artifact({
      id: 'art-img',
      name: 'foto.png',
      mimeType: 'image/png',
      kind: 'image',
      size: 3000,
      createdAt: BASE_TIME + 3,
      favorite: true,
      conversationTitle: 'Viagem',
    }),
    artifact({
      id: 'art-docx',
      name: 'contrato.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'docx',
      size: 2000,
      createdAt: BASE_TIME + 2,
      conversationTitle: 'Jurídico',
    }),
    artifact({
      id: 'art-code',
      name: 'main.py',
      mimeType: 'text/x-python',
      kind: 'code',
      language: 'python',
      size: 1500,
      createdAt: BASE_TIME + 1,
      conversationId: null,
      conversationTitle: null,
    }),
    artifact({
      id: 'art-audio',
      name: 'audio.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      size: 800,
      createdAt: BASE_TIME,
      conversationId: null,
      conversationTitle: null,
    }),
    artifact({
      id: 'art-zip',
      name: 'pacote.zip',
      mimeType: 'application/zip',
      kind: 'archive',
      size: 4000,
      createdAt: BASE_TIME - 1,
      conversationTitle: 'Arquivos antigos',
    }),
  ];
}

function contentFor(id: string): ArtifactContent | null {
  const found = libraryFixture().find((entry) => entry.id === id);
  if (!found) return null;
  if (found.kind === 'markdown') {
    return { artifact: found, content: `# ${found.name}\n\nConteúdo de ${found.name}.` };
  }
  if (found.kind === 'code') {
    return { artifact: found, content: 'print("olá")\n' };
  }
  return { artifact: found, content: 'conteúdo de teste', dataBase64: null };
}

function cardButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: /^Abrir / });
}

function cardNames(): string[] {
  return cardButtons().map(
    (button) => button.getAttribute('aria-label')?.replace(/^Abrir /, '').split(' — ')[0] ?? '',
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openPreview(name: string): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(`^Abrir ${escapeRegExp(name)}`) }),
  );
  return screen.findByRole('dialog', { name });
}

async function openCardMenu(name: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `Ações de ${name}` }));
  return screen.findByRole('menu');
}

function renderView() {
  return render(<LibraryView />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLibraryArtifacts.mockResolvedValue(libraryFixture());
  mocks.importLibraryFiles.mockResolvedValue([]);
  mocks.renameArtifact.mockImplementation(async (id: string, name: string) => {
    const found = libraryFixture().find((entry) => entry.id === id) ?? artifact({ id, name });
    return { ...found, name };
  });
  mocks.setArtifactFavorite.mockImplementation(async (id: string, favorite: boolean) => {
    const found = libraryFixture().find((entry) => entry.id === id) ?? artifact({ id });
    return { ...found, favorite };
  });
  mocks.getArtifactThumbnail.mockResolvedValue(null);
  mocks.getArtifactContent.mockImplementation(async (id: string) => contentFor(id));
  mocks.getArtifactPreview.mockResolvedValue(null);
  mocks.saveArtifact.mockResolvedValue('C:\\Users\\eu\\Downloads\\arquivo.md');
  mocks.openArtifact.mockResolvedValue(undefined);
  mocks.deleteArtifact.mockResolvedValue(undefined);
  dialogMocks.open.mockResolvedValue(null);
  useUiStore.setState({ activeView: 'library' });
});

afterEach(() => cleanup());

describe('LibraryView — estrutura e carregamento', () => {
  it('renderiza como view principal, com header, busca, filtros e ações', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    expect(screen.getByRole('region', { name: 'Biblioteca de arquivos' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeTruthy();
    expect(screen.getByText(/Todos os arquivos das suas conversas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voltar ao chat' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Pesquisar na biblioteca' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar arquivos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ordenar: Recentes/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Modo de visualização' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Grade' }).getAttribute('aria-checked')).toBe('true');

    const filters = screen.getByRole('radiogroup', { name: 'Filtrar biblioteca' });
    expect(within(filters).getAllByRole('radio')).toHaveLength(7);
    expect(within(filters).getByRole('radio', { name: 'Tudo (8 arquivos)' })).toBeTruthy();
    expect(within(filters).getByRole('radio', { name: 'Favoritos (1 arquivo)' })).toBeTruthy();
    expect(within(filters).getByRole('radio', { name: 'Documentos (4 arquivos)' })).toBeTruthy();
  });

  it('move o foco para a view ao montar', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Biblioteca de arquivos' }));
  });

  it('mostra o carregamento enquanto busca a biblioteca', () => {
    mocks.listLibraryArtifacts.mockReturnValue(new Promise(() => undefined));

    renderView();

    expect(screen.getByText('Carregando biblioteca…')).toBeTruthy();
    expect(mocks.listLibraryArtifacts).toHaveBeenCalledTimes(1);
  });

  it('mostra erro e refaz a busca em “Tentar novamente”', async () => {
    mocks.listLibraryArtifacts
      .mockRejectedValueOnce(new Error('banco indisponível'))
      .mockResolvedValueOnce(libraryFixture());

    renderView();

    expect(await screen.findByText('Não foi possível carregar a biblioteca')).toBeTruthy();
    expect(screen.getByText('banco indisponível')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('button', { name: /^Abrir notas\.md/ })).toBeTruthy();
    expect(mocks.listLibraryArtifacts).toHaveBeenCalledTimes(2);
  });

  it('mostra o estado vazio com CTA para enviar arquivos', async () => {
    mocks.listLibraryArtifacts.mockResolvedValue([]);

    renderView();

    expect(await screen.findByText('Sua biblioteca está vazia')).toBeTruthy();
    // Header + empty state CTA.
    expect(screen.getAllByRole('button', { name: 'Enviar arquivos' })).toHaveLength(2);
    expect(screen.getByText(/Os arquivos criados pelo agente durante as conversas/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Arquivos da biblioteca' })).toBeNull();
  });
});

describe('LibraryView — listagem, busca e filtros', () => {
  it('renderiza todos os artefatos em cards com tipo, tamanho, data e origem', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    expect(cardButtons()).toHaveLength(8);
    const notes = screen.getByRole('button', { name: /^Abrir notas\.md/ });
    expect(notes.getAttribute('aria-label')).toBe('Abrir notas.md — Markdown · Projeto Aurora');
    expect(notes.textContent).toContain('Markdown');
    expect(notes.textContent).toContain('100 B');
    expect(notes.textContent).toContain('Projeto Aurora');

    const upload = screen.getByRole('button', { name: /^Abrir main\.py/ });
    expect(upload.textContent).toContain('Biblioteca');
  });

  it('busca por nome sem acentos e limpa a busca', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const search = screen.getByRole('searchbox', { name: 'Pesquisar na biblioteca' });

    fireEvent.change(search, { target: { value: 'RELATORIO' } });
    expect(cardNames()).toEqual(['relatorio.pdf']);

    fireEvent.change(search, { target: { value: 'reuniao' } });
    expect(cardNames()).toEqual(['resumo.md']);

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(cardNames()).toEqual([]);
    expect(screen.getByText('Nenhum artefato encontrado')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(cardButtons()).toHaveLength(8);
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('mostra o estado de filtro sem resultados com “Limpar filtros”', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    const filters = screen.getByRole('radiogroup', { name: 'Filtrar biblioteca' });
    fireEvent.click(within(filters).getByRole('radio', { name: 'Favoritos (1 arquivo)' }));
    // Only the favorite image matches; combine with a search that matches nothing.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar na biblioteca' }), {
      target: { value: 'notas' },
    });

    expect(screen.getByText('Nenhum artefato encontrado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    expect(cardButtons()).toHaveLength(8);
    expect(
      within(filters).getByRole('radio', { name: 'Tudo (8 arquivos)' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it.each([
    ['Favoritos (1 arquivo)', ['foto.png']],
    ['Imagens (1 arquivo)', ['foto.png']],
    ['Documentos (4 arquivos)', ['notas.md', 'resumo.md', 'relatorio.pdf', 'contrato.docx']],
    ['Código (1 arquivo)', ['main.py']],
    ['Mídia (1 arquivo)', ['audio.mp3']],
    ['Outros (1 arquivo)', ['pacote.zip']],
  ])('filtra pela pill %s', async (radioName, expected) => {
    renderView();
    await screen.findAllByRole('listitem');

    const filters = screen.getByRole('radiogroup', { name: 'Filtrar biblioteca' });
    const radio = within(filters).getByRole('radio', { name: radioName });
    fireEvent.click(radio);

    expect(radio.getAttribute('aria-checked')).toBe('true');
    expect(cardNames().sort()).toEqual([...expected].sort());
  });

  it('“Tudo” restaura a biblioteca completa', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    const filters = screen.getByRole('radiogroup', { name: 'Filtrar biblioteca' });
    fireEvent.click(within(filters).getByRole('radio', { name: 'Favoritos (1 arquivo)' }));
    expect(cardButtons()).toHaveLength(1);

    fireEvent.click(within(filters).getByRole('radio', { name: 'Tudo (8 arquivos)' }));
    expect(cardButtons()).toHaveLength(8);
  });
});

describe('LibraryView — ordenação', () => {
  it('ordena por recentes por padrão', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    expect(cardNames()).toEqual([
      'notas.md',
      'resumo.md',
      'relatorio.pdf',
      'foto.png',
      'contrato.docx',
      'main.py',
      'audio.mp3',
      'pacote.zip',
    ]);
  });

  it('ordena por mais antigos, nome e tamanho pelo menu', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Ordenar: Recentes/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mais antigos' }));
    expect(cardNames()[0]).toBe('pacote.zip');
    expect(cardNames()[7]).toBe('notas.md');

    await user.click(screen.getByRole('button', { name: /^Ordenar: Mais antigos/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Nome (A–Z)' }));
    expect(cardNames()).toEqual([
      'audio.mp3',
      'contrato.docx',
      'foto.png',
      'main.py',
      'notas.md',
      'pacote.zip',
      'relatorio.pdf',
      'resumo.md',
    ]);

    await user.click(screen.getByRole('button', { name: /^Ordenar: Nome/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Tamanho' }));
    expect(cardNames()[0]).toBe('relatorio.pdf');
    expect(cardNames()[7]).toBe('notas.md');
  });
});

describe('LibraryView — grade e lista', () => {
  it('alterna entre grade e lista mantendo os mesmos itens', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    const grid = screen.getByRole('list', { name: 'Arquivos da biblioteca' });
    expect(grid.className).toContain('grid-cols-');

    fireEvent.click(screen.getByRole('radio', { name: 'Lista' }));

    expect(screen.getByRole('radio', { name: 'Lista' }).getAttribute('aria-checked')).toBe('true');
    const list = screen.getByRole('list', { name: 'Arquivos da biblioteca' });
    expect(list.className).toContain('flex-col');
    expect(cardButtons()).toHaveLength(8);

    fireEvent.click(screen.getByRole('radio', { name: 'Grade' }));
    expect(
      screen.getByRole('list', { name: 'Arquivos da biblioteca' }).className,
    ).toContain('grid-cols-');
  });
});

describe('LibraryView — upload e drag & drop', () => {
  it('abre o seletor nativo, importa e atualiza a lista com toast', async () => {
    const imported = artifact({
      id: 'art-new',
      name: 'novo-arquivo.pdf',
      mimeType: 'application/pdf',
      kind: 'pdf',
      conversationId: null,
      conversationTitle: null,
      size: 700,
      createdAt: BASE_TIME + 10,
    });
    dialogMocks.open.mockResolvedValue(['C:\\tmp\\novo-arquivo.pdf']);
    mocks.importLibraryFiles.mockResolvedValueOnce([imported]);
    mocks.listLibraryArtifacts
      .mockResolvedValueOnce(libraryFixture())
      .mockResolvedValueOnce([imported, ...libraryFixture()]);

    renderView();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar arquivos' }));

    await waitFor(() =>
      expect(dialogMocks.open).toHaveBeenCalledWith(
        expect.objectContaining({ multiple: true }),
      ),
    );
    await waitFor(() =>
      expect(mocks.importLibraryFiles).toHaveBeenCalledWith(['C:\\tmp\\novo-arquivo.pdf']),
    );
    expect(await screen.findByRole('button', { name: /^Abrir novo-arquivo\.pdf/ })).toBeTruthy();
    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('1 arquivo enviado'),
    );
  });

  it('mostra “Enviando arquivos…” enquanto importa', async () => {
    let resolveImport: (value: unknown[]) => void = () => undefined;
    dialogMocks.open.mockResolvedValue(['C:\\tmp\\a.pdf']);
    mocks.importLibraryFiles.mockImplementation(
      () => new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );

    renderView();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar arquivos' }));

    expect(await screen.findByRole('button', { name: 'Enviando arquivos…' })).toBeTruthy();

    await act(async () => {
      resolveImport([]);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar arquivos' })).toBeTruthy());
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith('Nenhum arquivo enviado');
  });

  it('reporta falha de importação sem quebrar a lista', async () => {
    dialogMocks.open.mockResolvedValue(['C:\\tmp\\falha.pdf']);
    mocks.importLibraryFiles.mockRejectedValueOnce(new Error('sem permissão'));

    renderView();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar arquivos' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(cardButtons()).toHaveLength(8);
  });

  it('importa arquivos soltos pelo evento de drag & drop do App', async () => {
    mocks.importLibraryFiles.mockResolvedValueOnce([]);

    renderView();
    await screen.findAllByRole('listitem');

    act(() => {
      window.dispatchEvent(new CustomEvent('lumina:library-drag', { detail: { active: true } }));
    });
    expect(screen.getByText('Solte para enviar à biblioteca')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('lumina:library-drop', { detail: { paths: ['C:\\tmp\\drop.pdf'] } }),
      );
    });

    await waitFor(() =>
      expect(mocks.importLibraryFiles).toHaveBeenCalledWith(['C:\\tmp\\drop.pdf']),
    );
    expect(screen.queryByText('Solte para enviar à biblioteca')).toBeNull();
  });

  it('abre o seletor quando a paleta dispara lumina:library-import', async () => {
    dialogMocks.open.mockResolvedValue(['C:\\tmp\\paleta.pdf']);
    mocks.importLibraryFiles.mockResolvedValueOnce([]);

    renderView();
    await screen.findAllByRole('listitem');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('lumina:library-import'));
    });

    await waitFor(() => expect(dialogMocks.open).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.importLibraryFiles).toHaveBeenCalledWith(['C:\\tmp\\paleta.pdf']),
    );
  });
});

describe('LibraryView — favoritos e miniaturas', () => {
  it('favorita pelo card e reflete na API e na estrela', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Favoritar relatorio.pdf' }));

    await waitFor(() =>
      expect(mocks.setArtifactFavorite).toHaveBeenCalledWith('art-pdf', true),
    );
    expect(await screen.findByRole('button', { name: 'Desfavoritar relatorio.pdf' })).toBeTruthy();
  });

  it('desfavorita um artefato já favorito', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Desfavoritar foto.png' }));

    await waitFor(() => expect(mocks.setArtifactFavorite).toHaveBeenCalledWith('art-img', false));
    expect(await screen.findByRole('button', { name: 'Favoritar foto.png' })).toBeTruthy();
  });

  it('reverte a estrela quando a API falha', async () => {
    mocks.setArtifactFavorite.mockRejectedValueOnce(new Error('falha ao salvar'));

    renderView();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Favoritar relatorio.pdf' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Favoritar relatorio.pdf' })).toBeTruthy();
  });

  it('mostra a miniatura real das imagens e cai no ícone quando não há', async () => {
    mocks.getArtifactThumbnail.mockImplementation(async (id: string) =>
      id === 'art-img'
        ? { mime: 'image/png', dataBase64: 'iVBORw0KGgo=', width: 32, height: 32 }
        : null,
    );

    renderView();
    await screen.findAllByRole('listitem');

    const thumbnail = await screen.findByRole('img', { name: 'Miniatura de foto.png' });
    expect(thumbnail.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(mocks.getArtifactThumbnail).toHaveBeenCalledWith('art-img');
    expect(mocks.getArtifactThumbnail).toHaveBeenCalledTimes(1);
  });
});

describe('LibraryView — prévia e gestão', () => {
  it('abre a prévia do artefato e carrega o conteúdo', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    const dialog = await openPreview('notas.md');

    expect(mocks.getArtifactContent).toHaveBeenCalledWith('art-md-2');
    expect(within(dialog).getByRole('heading', { level: 1, name: 'notas.md' })).toBeTruthy();
    expect(within(dialog).getAllByText('Markdown').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Projeto Aurora')).toBeTruthy();
    expect(within(dialog).getAllByText('1 de 8').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('region', { name: 'Prévia de notas.md' })).toBeTruthy();
  });

  it('navega para o próximo arquivo e mantém o rodapé X de N', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Próximo arquivo' }));

    const next = await screen.findByRole('dialog', { name: 'resumo.md' });
    expect(mocks.getArtifactContent).toHaveBeenLastCalledWith('art-md-1');
    expect(within(next).getAllByText('2 de 8').length).toBeGreaterThan(0);
    expect(
      within(next).getByRole('button', { name: 'Arquivo anterior' }),
    ).toBeTruthy();
  });

  it('fecha a prévia pelo botão Fechar', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('favorita pela prévia', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('relatorio.pdf');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Favoritar' }));

    await waitFor(() => expect(mocks.setArtifactFavorite).toHaveBeenCalledWith('art-pdf', true));
    expect(
      await within(screen.getByRole('dialog')).findByRole('button', { name: 'Desfavoritar' }),
    ).toBeTruthy();
  });

  it('salva como… e abre no aplicativo padrão', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar como…' }));
    await waitFor(() =>
      expect(mocks.saveArtifact).toHaveBeenCalledWith('art-md-2', 'notas.md'),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir' }));
    await waitFor(() => expect(mocks.openArtifact).toHaveBeenCalledWith('art-md-2'));
  });

  it('renomeia inline com Enter/“Salvar” e atualiza lista e título', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' }));
    const input = await within(dialog).findByRole('textbox', { name: 'Renomear arquivo' });
    expect((input as HTMLInputElement).value).toBe('notas.md');

    fireEvent.change(input, { target: { value: 'notas-renomeadas.md' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mocks.renameArtifact).toHaveBeenCalledWith('art-md-2', 'notas-renomeadas.md'),
    );
    expect(await screen.findByRole('dialog', { name: 'notas-renomeadas.md' })).toBeTruthy();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Arquivo renomeado',
      expect.objectContaining({ description: 'notas-renomeadas.md' }),
    );

    // Radix hides the page behind the modal dialog; close it to inspect the card.
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByRole('button', { name: /^Abrir notas-renomeadas\.md/ }),
    ).toBeTruthy();
  });

  it('cancela a renomeação com Esc sem fechar o dialog', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' }));
    const input = await within(dialog).findByRole('textbox', { name: 'Renomear arquivo' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(within(dialog).queryByRole('textbox', { name: 'Renomear arquivo' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'notas.md' })).toBeTruthy();
    expect(mocks.renameArtifact).not.toHaveBeenCalled();
  });

  it('mostra o erro de renomeação inline e mantém a edição', async () => {
    mocks.renameArtifact.mockRejectedValueOnce(new Error('já existe um arquivo com esse nome'));

    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Renomear' }));
    const input = within(dialog).getByRole('textbox', { name: 'Renomear arquivo' });
    fireEvent.change(input, { target: { value: 'conflito.md' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(
      await within(dialog).findByText('já existe um arquivo com esse nome'),
    ).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Renomear arquivo' })).toBeTruthy();
  });

  it('pede confirmação e exclui o arquivo, fechando a prévia', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('resumo.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir arquivo' }));
    const group = await within(dialog).findByRole('group', {
      name: 'Confirmar exclusão de resumo.md',
    });
    expect(within(group).getByText(/Esta ação não pode ser desfeita/)).toBeTruthy();

    fireEvent.click(within(group).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mocks.deleteArtifact).toHaveBeenCalledWith('art-md-1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Abrir resumo\.md/ })).toBeNull();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Arquivo excluído',
      expect.objectContaining({ description: 'resumo.md' }),
    );
  });

  it('cancela a exclusão e mantém o arquivo', async () => {
    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('resumo.md');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir arquivo' }));
    const group = await within(dialog).findByRole('group', {
      name: 'Confirmar exclusão de resumo.md',
    });
    fireEvent.click(within(group).getByRole('button', { name: 'Cancelar' }));

    expect(mocks.deleteArtifact).not.toHaveBeenCalled();
    expect(
      within(dialog).queryByRole('group', { name: 'Confirmar exclusão de resumo.md' }),
    ).toBeNull();
  });

  it('abre o dialog já no modo de renomeação pelo menu do card', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    const menu = await openCardMenu('notas.md');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Renomear' }));

    const dialog = await screen.findByRole('dialog', { name: 'notas.md' });
    expect(within(dialog).getByRole('textbox', { name: 'Renomear arquivo' })).toBeTruthy();
  });

  it('abre o dialog já na confirmação de exclusão pelo menu do card', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    const menu = await openCardMenu('pacote.zip');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir' }));

    const dialog = await screen.findByRole('dialog', { name: 'pacote.zip' });
    expect(
      within(dialog).getByRole('group', { name: 'Confirmar exclusão de pacote.zip' }),
    ).toBeTruthy();
  });

  it('mostra o erro de prévia e tenta novamente', async () => {
    mocks.getArtifactContent
      .mockRejectedValueOnce(new Error('arquivo ausente'))
      .mockResolvedValueOnce(contentFor('art-md-2'));

    renderView();
    await screen.findAllByRole('listitem');
    const dialog = await openPreview('notas.md');

    expect(
      await within(dialog).findByText('Não foi possível carregar a prévia'),
    ).toBeTruthy();
    expect(within(dialog).getByText('arquivo ausente')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));

    expect(
      await within(dialog).findByRole('heading', { level: 1, name: 'notas.md' }),
    ).toBeTruthy();
    expect(mocks.getArtifactContent).toHaveBeenCalledTimes(2);
  });
});

describe('LibraryView — navegação', () => {
  it('“Voltar ao chat” troca a view principal', async () => {
    renderView();
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao chat' }));

    expect(useUiStore.getState().activeView).toBe('chat');
  });
});
