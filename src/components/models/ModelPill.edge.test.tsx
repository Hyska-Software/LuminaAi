// @vitest-environment jsdom
/**
 * Verificação independente (task-5) — casos adversariais do `ModelPill`.
 *
 * Este arquivo NÃO substitui `ModelPill.test.tsx` (dono: ui-pill) e evita repetir
 * os cenários já cobertos lá. O foco aqui é: requisito novo da bolha flutuante de
 * detalhes (posicionamento, janela de tolerância de 120ms), busca hostil (acentos,
 * maiúsculas, emoji, espaços, 1 letra, query gigante), catálogo completo, modos de
 * pensamento exóticos (só-esforço, só-orçamento, toggle), foco, reset de abertura,
 * estados degenerados (catálogo vazio) e nomes longos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui';
import { ModelPill } from '@/components/models/ModelPill';
import { catalog } from '@/lib/catalog';
import type { ProviderInfo } from '@/lib/types';
import { useAppStore, useUiStore } from '@/lib/store';

// The store persists the selection through the settings command; there is no
// Tauri IPC in jsdom, so the call stays pending (the pill never awaits it).
vi.mock('@/lib/api', () => ({
  api: {
    saveSettings: vi.fn(() => new Promise(() => {})),
  },
}));

afterEach(() => cleanup());

const GO = 'opencode-go';
const ZEN = 'opencode-zen';
const CURRENT_MODEL = 'deepseek-v4.1-flash';
const LONG_NAME = 'Gemini 4 Argon Contributor';
const THINKING_ONLY_MODEL = 'gemini-4-argon-contributor';
const BUDGET_ONLY_MODEL = 'claude-haiku-4-5';
const TOGGLE_ONLY_MODEL = 'glm-5.1';

function renderPill(element: ReactElement = <ModelPill />) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

function modelTrigger(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Selecionar modelo\. Atual:/ }) as HTMLButtonElement;
}

function thinkingTrigger(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /^Selecionar modo de pensamento\. Atual:/,
  }) as HTMLButtonElement;
}

async function openModelStage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(modelTrigger());
  return screen.findByRole('dialog', { name: 'Selecionar modelo' });
}

async function openThinkingStage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(thinkingTrigger());
  return screen.findByRole('dialog', { name: 'Selecionar modelo' });
}

function optionById(id: string | null): HTMLElement | undefined {
  if (!id) return undefined;
  return document.getElementById(id) ?? undefined;
}

function classTokens(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

function hasToken(element: HTMLElement, fragment: string): boolean {
  return classTokens(element).some((token) => token.includes(fragment));
}

function closestWithToken(node: HTMLElement | null, fragment: string): HTMLElement | null {
  let current = node;
  while (current) {
    if (current.className && current.className.includes(fragment)) return current;
    current = current.parentElement;
  }
  return null;
}

function detailsBubble(dialog: HTMLElement): HTMLElement | null {
  return within(dialog).queryByRole('group', { name: 'Detalhes do modelo' });
}

/** Catalog stand-in with a single provider; used to inject hostile/dirty data. */
function providerWith(
  providerId: string,
  shortName: string,
  models: ProviderInfo['models'],
): ProviderInfo {
  const base = catalog.providers[0];
  return { ...base, id: providerId, name: `Provedor ${shortName}`, shortName, models };
}

function modelWith(
  overrides: Partial<ProviderInfo['models'][number]>,
): ProviderInfo['models'][number] {
  return { ...catalog.providers[0].models[0], ...overrides };
}

beforeEach(() => {
  useAppStore.setState({
    providers: catalog.providers,
    selection: {
      providerId: GO,
      modelId: CURRENT_MODEL,
      reasoning: { mode: 'effort', effort: 'high' },
    },
    favorites: ['glm-5.3-flash', 'claude-haiku-5-5'],
    keys: [
      { providerId: GO, hasKey: true, source: 'settings' },
      { providerId: ZEN, hasKey: false, source: 'none' },
    ],
    settings: {
      ...useAppStore.getState().settings,
      defaultProvider: GO,
      defaultModel: CURRENT_MODEL,
    },
  });
  useUiStore.setState({ modelPickerOpen: false, settingsOpen: false });
});

describe('ModelPill (edge) — bolha de detalhes flutuante', () => {
  it('surge no hover como bolha absoluta, sem deslocar a lista e sem posição inline no jsdom', async () => {
    const user = userEvent.setup();
    renderPill();

    const dialog = await openModelStage(user);
    // O popover compacto deixa a bolha escapar do overflow.
    expect(hasToken(dialog, 'w-[22rem]')).toBe(true);
    expect(hasToken(dialog, 'overflow-visible')).toBe(true);
    expect(detailsBubble(dialog)).toBeNull();

    await user.hover(within(dialog).getByRole('option', { name: /^Claude Haiku 5\.5/ }));

    const bubble = await within(dialog).findByRole('group', { name: 'Detalhes do modelo' });
    expect(hasToken(bubble, 'absolute')).toBe(true);
    expect(hasToken(bubble, 'w-[17rem]')).toBe(true);
    expect(hasToken(bubble, 'max-h-[min(20rem,calc(100dvh-4rem))]')).toBe(true);
    expect(hasToken(bubble, 'overflow-y-auto')).toBe(true);
    // jsdom não tem layout (rects zerados): a posição é omitida, sem quebrar.
    expect(bubble.hasAttribute('style')).toBe(false);
    // A lista continua inteira dentro do popover.
    expect(within(dialog).getByRole('listbox', { name: 'Modelos' })).toBeTruthy();
    expect(within(bubble).getByRole('heading', { name: 'Claude Haiku 5.5' })).toBeTruthy();
  });

  it('respeita a janela de tolerância (~120ms) antes de esconder a bolha', async () => {
    const user = userEvent.setup();
    renderPill();

    const dialog = await openModelStage(user);
    const row = within(dialog).getByRole('option', { name: /^Claude Haiku 5\.5/ });
    await user.hover(row);
    expect(await within(dialog).findByRole('group', { name: 'Detalhes do modelo' })).toBeTruthy();

    await user.unhover(row);

    // Não esconde imediatamente: o ponteiro ainda pode entrar na bolha.
    expect(detailsBubble(dialog)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(detailsBubble(dialog)).toBeTruthy();
    // Depois da janela, some.
    await waitFor(() => expect(detailsBubble(dialog)).toBeNull());
  });

  it('revela a bolha na navegação por teclado e mantém `aria-activedescendant` válido', async () => {
    const user = userEvent.setup();
    renderPill();

    const dialog = await openModelStage(user);
    const search = within(dialog).getByRole('combobox', { name: 'Buscar modelos' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(detailsBubble(dialog)).toBeNull();

    await user.keyboard('{ArrowDown}');

    const bubble = await within(dialog).findByRole('group', { name: 'Detalhes do modelo' });
    const activeId = search.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(optionById(activeId)).toBeTruthy();
    // A bolha não captura a combobox: o foco continua no campo de busca.
    expect(document.activeElement).toBe(search);
    expect(within(bubble).getByRole('heading', { level: 3 })).toBeTruthy();
  });
});

describe('ModelPill (edge) — busca hostil', () => {
  it('lida com query gigante, emoji e só espaços sem quebrar a navegação', async () => {
    const user = userEvent.setup();
    renderPill();

    const dialog = await openModelStage(user);
    const search = within(dialog).getByRole('combobox', { name: 'Buscar modelos' }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));

    await user.click(search);
    await user.paste('a'.repeat(3000));

    expect(within(dialog).getByText('Nenhum modelo encontrado')).toBeTruthy();
    expect(within(dialog).getByText('0 modelos')).toBeTruthy();
    expect(within(dialog).queryAllByRole('option')).toHaveLength(0);
    expect(search.getAttribute('aria-activedescendant')).toBeNull();

    // Com 0 resultados, o teclado não aplica nada nem fecha o popover.
    await user.keyboard('{ArrowDown}{ArrowUp}{Home}{End}{Enter}');
    expect(screen.getByRole('dialog', { name: 'Selecionar modelo' })).toBeTruthy();
    expect(useAppStore.getState().selection.modelId).toBe(CURRENT_MODEL);

    const emptyTitle = within(dialog).getByText('Nenhum modelo encontrado');
    const emptyState = emptyTitle.parentElement as HTMLElement;
    await user.click(within(emptyState).getByRole('button', { name: 'Limpar busca' }));
    expect(await within(dialog).findByRole('option', { name: 'DeepSeek V4 Pro' })).toBeTruthy();

    // Emoji não encontra nada e não derruba a busca.
    await user.type(search, '🚀');
    expect(within(dialog).getByText('Nenhum modelo encontrado')).toBeTruthy();

    await user.clear(search);
    await user.type(search, '    ');
    // Só espaços não é uma busca: o seletor de provedor continua visível.
    expect(within(dialog).getByRole('radio', { name: 'Go' })).toBeTruthy();
    expect(within(dialog).queryByText('Go + Zen + ChatGPT')).toBeNull();
    expect(within(dialog).getByText('37 modelos')).toBeTruthy();
  });

  it('normaliza maiúsculas e acentos (provedor injetado com "Céu Profundo Ômega")', async () => {
    const model = modelWith({
      id: 'ceu-profundo',
      name: 'Céu Profundo Ômega',
      family: 'custom',
      description: 'Modelo Órbita para testes de normalização',
      tags: ['vision'],
      reasoningOptions: [],
      status: 'stable',
    });
    useAppStore.setState({
      providers: [providerWith('cosmico', 'Cósmico', [model])],
      selection: { providerId: 'cosmico', modelId: 'ceu-profundo', reasoning: null },
      keys: [{ providerId: 'cosmico', hasKey: true, source: 'settings' }],
    });

    const user = userEvent.setup();
    renderPill();

    const dialog = await openModelStage(user);
    const search = within(dialog).getByRole('combobox', { name: 'Buscar modelos' }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));

    await user.type(search, 'CEU PROFUNDO');
    expect(await within(dialog).findByRole('option', { name: /Céu Profundo Ômega/ })).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'órbita');
    expect(await within(dialog).findByRole('option', { name: /Céu Profundo Ômega/ })).toBeTruthy();

    await user.clear(search);
    await user.type(search, '🚀');
    expect(within(dialog).getByText('Nenhum modelo encontrado')).toBeTruthy();
  });

  it('busca global no catálogo inteiro: 119 modelos, ids únicos e destaque válido', async () => {
    const user = userEvent.setup();
    renderPill();

    const dialog = await openModelStage(user);
    const search = within(dialog).getByRole('combobox', { name: 'Buscar modelos' });
    await waitFor(() => expect(document.activeElement).toBe(search));

    await user.type(search, 'opencode');

    // 37 disponíveis no Go + 82 no Zen (o pill esconde indisponíveis).
    expect(within(dialog).getByText('119 modelos')).toBeTruthy();
    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(119);
    expect(new Set(options.map((option) => option.id)).size).toBe(119);
    expect(within(dialog).getByText('Go + Zen + ChatGPT')).toBeTruthy();

    const activeId = search.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(optionById(activeId)).toBeTruthy();
  });
});

describe('ModelPill (edge) — etapa de pensamento compacta', () => {
  it('não herda a largura da etapa de modelos e limita a altura com rolagem interna', async () => {
    const user = userEvent.setup();
    renderPill();

    const thinkingDialog = await openThinkingStage(user);
    // Menu de pensamento: 15–19rem, dimensionado pelo conteúdo.
    expect(hasToken(thinkingDialog, 'w-auto')).toBe(true);
    expect(hasToken(thinkingDialog, 'min-w-[15rem]')).toBe(true);
    expect(hasToken(thinkingDialog, 'max-w-[19rem]')).toBe(true);
    expect(hasToken(thinkingDialog, 'w-[22rem]')).toBe(false);

    const listbox = within(thinkingDialog).getByRole('listbox', { name: 'Modo de pensamento' });
    // Altura automática com limite de viewport + rolagem só quando precisa.
    const scrollHost = closestWithToken(listbox.parentElement, 'overflow-y-auto');
    expect(scrollHost).toBeTruthy();
    expect(hasToken(scrollHost as HTMLElement, 'min-h-0')).toBe(true);
    const heightCap = closestWithToken(listbox.parentElement, 'max-h-[min(24rem');
    expect(heightCap).toBeTruthy();
    expect(hasToken(heightCap as HTMLElement, 'w-full')).toBe(true);
    expect(classTokens(heightCap as HTMLElement).some((token) => token.startsWith('h-['))).toBe(false);
    // A própria lista também tem teto próprio (não é altura fixa).
    expect(hasToken(listbox, 'max-h-[min(17rem')).toBe(true);
    expect(classTokens(listbox).some((token) => token.startsWith('h-['))).toBe(false);

    // Voltar restaura a etapa de modelos (popover compacto de 22rem).
    await user.click(screen.getByRole('button', { name: 'Voltar para a lista de modelos' }));
    const modelDialog = await screen.findByRole('dialog', { name: 'Selecionar modelo' });
    expect(hasToken(modelDialog, 'w-[22rem]')).toBe(true);
    expect(hasToken(modelDialog, 'w-auto')).toBe(false);
  });

  it('modelo só com esforço ("sempre pensa"): sem Desligado e Enter aplica o esforço atual', async () => {
    useAppStore.setState({
      selection: {
        providerId: GO,
        modelId: THINKING_ONLY_MODEL,
        reasoning: { mode: 'effort', effort: 'high' },
      },
    });
    const user = userEvent.setup();
    renderPill();

    const dialog = await openThinkingStage(user);
    expect(
      within(dialog).getByText('Este modelo sempre pensa; escolha o nível de esforço.'),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: /^Desligado/ })).toBeNull();
    const options = within(dialog).getAllByRole('option');
    expect(options.map((option) => option.textContent?.split('Rápido')[0])).toHaveLength(3);
    expect(within(dialog).getByRole('option', { name: /^Alto/ }).getAttribute('aria-selected')).toBe(
      'true',
    );

    const listbox = within(dialog).getByRole('listbox', { name: 'Modo de pensamento' });
    await waitFor(() => expect(document.activeElement).toBe(listbox));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useAppStore.getState().selection.reasoning).toEqual({ mode: 'effort', effort: 'high' });
    await waitFor(() => expect(document.activeElement).toBe(thinkingTrigger()));
  });

  it('modelo só com orçamento: presets de tokens, sem Desligado, e commit do orçamento', async () => {
    useAppStore.setState({
      selection: { providerId: ZEN, modelId: BUDGET_ONLY_MODEL, reasoning: null },
    });
    const user = userEvent.setup();
    renderPill();

    const dialog = await openThinkingStage(user);
    expect(
      within(dialog).getByText('Este modelo sempre pensa; escolha o orçamento de tokens.'),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: /^Desligado/ })).toBeNull();
    expect(within(dialog).getByRole('option', { name: /^Rápido/ })).toBeTruthy();
    expect(within(dialog).getByRole('option', { name: /^Equilibrado/ })).toBeTruthy();
    expect(within(dialog).getByRole('option', { name: /^Profundo/ })).toBeTruthy();
    expect(within(dialog).getByRole('option', { name: /^Máximo/ })).toBeTruthy();

    await user.click(within(dialog).getByRole('option', { name: /^Profundo/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useAppStore.getState().selection).toEqual({
      providerId: ZEN,
      modelId: BUDGET_ONLY_MODEL,
      reasoning: { mode: 'budget', budget: 16384 },
    });
  });

  it('modelo só liga/desliga: expõe Desligado + Ligado e aplica "Ligado"', async () => {
    useAppStore.setState({
      selection: { providerId: GO, modelId: TOGGLE_ONLY_MODEL, reasoning: { mode: 'off' } },
    });
    const user = userEvent.setup();
    renderPill();

    const dialog = await openThinkingStage(user);
    expect(within(dialog).queryByText(/sempre pensa/)).toBeNull();
    expect(within(dialog).getByRole('option', { name: /^Desligado/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await user.click(within(dialog).getByRole('option', { name: /^Ligado/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useAppStore.getState().selection.reasoning).toEqual({ mode: 'effort', effort: null });
  });

  it('Home/End navegam no listbox de pensamento e Enter aplica a opção ativa', async () => {
    const user = userEvent.setup();
    renderPill();

    await openThinkingStage(user);
    const listbox = screen.getByRole('listbox', { name: 'Modo de pensamento' });
    await waitFor(() => expect(document.activeElement).toBe(listbox));

    await user.keyboard('{End}');
    expect(optionById(listbox.getAttribute('aria-activedescendant'))?.textContent).toContain('Máximo');

    await user.keyboard('{Home}');
    expect(optionById(listbox.getAttribute('aria-activedescendant'))?.textContent).toContain(
      'Desligado',
    );

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useAppStore.getState().selection.reasoning).toEqual({ mode: 'off' });
  });
});

describe('ModelPill (edge) — foco, reset e estados degenerados', () => {
  it('Esc e aplicação de pensamento devolvem o foco ao segmento ✦', async () => {
    const user = userEvent.setup();
    renderPill();

    await openThinkingStage(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(thinkingTrigger()));

    await openThinkingStage(user);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(thinkingTrigger()));
    expect(useAppStore.getState().selection.reasoning).toEqual({ mode: 'effort', effort: 'high' });
  });

  it('reabrir sempre volta à etapa de modelo, com busca limpa e provedor atual', async () => {
    const user = userEvent.setup();
    renderPill();

    let dialog = await openModelStage(user);
    const search = within(dialog).getByRole('combobox', { name: 'Buscar modelos' }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.type(search, 'glm');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openModelStage(user);
    const reopened = within(dialog).getByRole('combobox', {
      name: 'Buscar modelos',
    }) as HTMLInputElement;
    expect(reopened.value).toBe('');
    expect(within(dialog).getByRole('radio', { name: 'Go' })).toBeTruthy();
    expect(within(dialog).queryByText('Modo de pensamento')).toBeNull();

    // E a etapa ✦ volta sempre fechada ao reabrir o popover.
    await user.click(thinkingTrigger());
    await screen.findByRole('listbox', { name: 'Modo de pensamento' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openModelStage(user);
    expect(screen.getByRole('combobox', { name: 'Buscar modelos' })).toBeTruthy();
  });

  it('catálogo sem modelos disponíveis mostra estado vazio e não trava o teclado', async () => {
    const unavailable = modelWith({
      id: 'modelo-indisponivel',
      name: 'Modelo Indisponível',
      reasoningOptions: [],
      status: 'unavailable',
    });
    useAppStore.setState({
      providers: [providerWith('provider-x', 'X', [unavailable])],
      selection: { providerId: 'provider-x', modelId: 'modelo-indisponivel', reasoning: null },
      keys: [{ providerId: 'provider-x', hasKey: false, source: 'none' }],
    });

    const user = userEvent.setup();
    renderPill();

    // The pill resolves the model against the merged store list, so even a
    // store-injected slug shows its display name instead of the raw id.
    expect(modelTrigger().getAttribute('aria-label')).toContain('Modelo Indisponível');

    const dialog = await openModelStage(user);
    expect(within(dialog).getByText('Nenhum modelo encontrado')).toBeTruthy();
    expect(within(dialog).getByText('0 modelos')).toBeTruthy();
    expect(within(dialog).queryAllByRole('listbox')).toHaveLength(0);
    // Sem "Limpar busca" (não há busca a limpar) e sem crash com o teclado.
    expect(within(dialog).queryByRole('button', { name: 'Limpar busca' })).toBeNull();
    await user.keyboard('{ArrowDown}{Home}{Enter}');
    expect(screen.getByRole('dialog', { name: 'Selecionar modelo' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('nomes longos continuam legíveis para tecnologia assistiva (pill, bolha e etapa 2)', async () => {
    useAppStore.setState({
      selection: {
        providerId: GO,
        modelId: THINKING_ONLY_MODEL,
        reasoning: { mode: 'effort', effort: 'high' },
      },
    });
    const user = userEvent.setup();
    renderPill();

    // O rótulo visual trunca, mas o nome acessível é completo.
    expect(modelTrigger().getAttribute('aria-label')).toBe(`Selecionar modelo. Atual: ${LONG_NAME}`);
    const nameSpan = screen.getByText(LONG_NAME);
    expect(hasToken(nameSpan, 'truncate')).toBe(true);
    expect(hasToken(nameSpan, 'max-w-36')).toBe(true);

    const modelDialog = await openModelStage(user);
    await user.hover(within(modelDialog).getByRole('option', { name: new RegExp(LONG_NAME) }));
    const bubble = await within(modelDialog).findByRole('group', { name: 'Detalhes do modelo' });
    const heading = within(bubble).getByRole('heading', { level: 3 });
    expect(heading.getAttribute('title')).toBe(LONG_NAME);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const thinkingDialog = await openThinkingStage(user);
    const header = within(thinkingDialog).getByText(LONG_NAME);
    expect(header.getAttribute('title')).toBe(LONG_NAME);
  });
});

describe('ModelPill (edge) — teclado: Tab no popover', () => {
  /**
   * Guarda de acessibilidade (DESIGN §12): o Radix monta o conteúdo do popover
   * dentro de um `FocusScope` com `loop: true` mesmo no modo non-modal, o que
   * prendia o Tab entre busca → provedor → "Ver todos os modelos…". O primitivo
   * `PopoverContent` neutraliza o loop no primeiro/último tabbable; este teste
   * garante que o foco alcança elementos fora do popover.
   */
  it('Tab não fica preso dentro do popover', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <div>
          <button type="button">Antes do pill</button>
          <ModelPill />
          <button type="button">Depois do pill</button>
        </div>
      </TooltipProvider>,
    );

    const dialog = await openModelStage(user);
    const search = within(dialog).getByRole('combobox', { name: 'Buscar modelos' });
    await waitFor(() => expect(document.activeElement).toBe(search));

    let reachedOutside = false;
    for (let step = 0; step < 10 && !reachedOutside; step += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active && !dialog.contains(active)) reachedOutside = true;
    }

    expect(reachedOutside).toBe(true);
  });
});

