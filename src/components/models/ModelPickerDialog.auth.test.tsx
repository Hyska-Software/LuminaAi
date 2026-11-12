// @vitest-environment jsdom
/**
 * T4.3 — OpenAI no seletor de modelos: aba do provedor, modelos da conta
 * (mesclados) com selo `estimated`, CTA de conta quando o provedor OAuth não
 * está conectado, selo de plano (preço por token escondido) e favoritos por
 * `providerId:modelId` (com leitura legada por id).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

const external = vi.hoisted(() => ({ openExternal: vi.fn().mockResolvedValue(true) }));

vi.mock('@/lib/genui/open-external', () => external);

vi.mock('@/lib/api', () => ({
  api: { saveSettings: vi.fn(() => new Promise(() => {})) },
}));

import { TooltipProvider } from '@/components/ui';
import { ModelPickerDialog } from '@/components/models/ModelPickerDialog';
import { catalog } from '@/lib/catalog';
import type { ModelInfo, ProviderAuthStatus, ProviderInfo } from '@/lib/types';
import { useAppStore, useUiStore } from '@/lib/store';

afterEach(() => cleanup());

const GO = 'opencode-go';
const ZEN = 'opencode-zen';
const OPENAI = 'openai';
const CURRENT_PROVIDER = GO;
const CURRENT_MODEL = 'deepseek-v4.1-flash';

const OPENAI_USAGE = 'https://chatgpt.com/settings/usage';

function openAiProvider(): ProviderInfo {
  const provider = catalog.providers.find((entry) => entry.id === OPENAI);
  if (!provider) throw new Error('openai provider missing from catalog');
  return provider;
}

/** Catalog plus one account-only (estimated) model merged by the backend. */
const ACCOUNT_ONLY: ModelInfo = {
  ...openAiProvider().models[0],
  id: 'gpt-6.1-sol-extra',
  name: 'GPT-6.1 Sol Extra',
  estimated: true,
};

function providersWithAccountModel(): ProviderInfo[] {
  return catalog.providers.map((provider) =>
    provider.id === OPENAI
      ? { ...provider, models: [...provider.models, ACCOUNT_ONLY] }
      : provider,
  );
}

const SIGNED_IN: ProviderAuthStatus = {
  providerId: OPENAI,
  mode: 'oauth',
  state: 'signed-in',
  accountLabel: 'user@example.com',
  planUsage: true,
  expiresAt: Date.now() + 3_600_000,
  scopes: ['openid', 'offline_access', 'chatgpt.tokens.use.direct'],
  clientIdMasked: 'oaiapp_…1234',
  hostIdMasked: 'urn:uuid:…5678',
  hint: null,
};

function baseKeys() {
  return [
    { providerId: GO, hasKey: true, source: 'settings' as const },
    { providerId: ZEN, hasKey: true, source: 'settings' as const },
    { providerId: OPENAI, hasKey: false, source: 'none' as const, mode: 'oauth' as const },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ modelPickerOpen: true, settingsOpen: false, settingsTab: 'data' });
  useAppStore.setState({
    providers: providersWithAccountModel(),
    selection: {
      providerId: CURRENT_PROVIDER,
      modelId: CURRENT_MODEL,
      reasoning: { mode: 'effort', effort: 'max' },
    },
    favorites: [],
    keys: baseKeys(),
    auth: [],
  });
});

function searchField(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Buscar modelos' }) as HTMLInputElement;
}

function modelDetails(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Detalhes do modelo' });
}

async function renderOpenDialog() {
  render(
    <TooltipProvider>
      <ModelPickerDialog />
    </TooltipProvider>,
  );
  await screen.findByRole('dialog');
  await waitFor(() => expect(document.activeElement).toBe(searchField()));
  return screen.getByRole('dialog');
}

/** Opens the provider dropdown and picks a provider (or All). */
async function selectProvider(
  user: UserEvent,
  name: string,
) {
  await user.click(screen.getByRole('button', { name: 'Provedores' }));
  await user.click(await screen.findByRole('menuitemradio', { name }));
}

async function openOpenAiTab(user: UserEvent) {
  await selectProvider(user, 'ChatGPT');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Provedores' }).textContent).toContain(
      'ChatGPT',
    ),
  );
}

describe('ModelPickerDialog — provedor OpenAI', () => {
  it('lista os cinco provedores do catálogo, incluindo OpenAI (ChatGPT), Anthropic e Gemini', async () => {
    await renderOpenDialog();
    const user = userEvent.setup();

    const trigger = screen.getByRole('button', { name: 'Provedores' });
    expect(trigger.textContent).toContain('Go');
    await user.click(trigger);

    const items = await screen.findAllByRole('menuitemradio');
    expect(items).toHaveLength(6);
    expect(screen.getByRole('menuitemradio', { name: 'Todos os provedores' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Go' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Zen' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'ChatGPT' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Anthropic' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Gemini' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Go' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('mostra modelos que só existem na conta, com selo Estimado', async () => {
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    await user.type(searchField(), 'gpt-6.1-sol-extra');

    const option = await screen.findByRole('option', { name: /GPT-6.1 Sol Extra/ });
    expect(within(option).getByText('Estimado')).toBeTruthy();

    await user.click(option);

    const details = modelDetails();
    expect(within(details).getByRole('heading', { name: 'GPT-6.1 Sol Extra' })).toBeTruthy();
    expect(within(details).getByText('Estimado')).toBeTruthy();
  });

  it('sem conta conectada, mostra Conectar conta ChatGPT e abre Configurações › Provedores', async () => {
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    const details = modelDetails();
    expect(
      within(details).getByText(/Conecte sua conta ChatGPT para usar estes modelos/),
    ).toBeTruthy();
    const connect = within(details).getByRole('button', { name: 'Conectar conta ChatGPT' });

    await user.click(connect);

    await waitFor(() => expect(useUiStore.getState().settingsOpen).toBe(true));
    expect(useUiStore.getState().settingsTab).toBe('providers');
    expect(useUiStore.getState().modelPickerOpen).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('conta conectada ao plano: selo Plano ChatGPT, preço por token escondido e Gerenciar uso', async () => {
    useAppStore.setState({ auth: [SIGNED_IN] });
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Plano ChatGPT')).toBeTruthy();

    const details = modelDetails();
    expect(within(details).getByText('Incluído no seu plano ChatGPT')).toBeTruthy();
    expect(within(details).queryByText('Custo (1M tok.)')).toBeNull();

    await user.click(within(details).getByRole('button', { name: /Gerenciar uso/ }));
    expect(external.openExternal).toHaveBeenCalledWith(OPENAI_USAGE);
  });

  it('plan-disabled conecta a conta mas pede ativação do plano', async () => {
    useAppStore.setState({
      auth: [{ ...SIGNED_IN, state: 'plan-disabled', planUsage: false }],
    });
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    const details = modelDetails();
    expect(within(details).getByText(/não está ativado/i)).toBeTruthy();
    expect(within(details).getByRole('button', { name: 'Ativar uso do plano' })).toBeTruthy();
  });

  it('regressão Go/Zen: sem CTA de conta e com preço por token', async () => {
    useAppStore.setState({ auth: [SIGNED_IN] });
    await renderOpenDialog();
    const user = userEvent.setup();

    const goDetails = modelDetails();
    expect(within(goDetails).queryByText(/Conta ChatGPT/i)).toBeNull();
    expect(within(goDetails).getByText('Custo (1M tok.)')).toBeTruthy();

    await selectProvider(user, 'Zen');
    const zenDetails = modelDetails();
    expect(within(zenDetails).queryByText(/Conta ChatGPT/i)).toBeNull();
    expect(within(zenDetails).getByText('Custo (1M tok.)')).toBeTruthy();
  });
});

describe('ModelPickerDialog — favoritos por par', () => {
  it('favorito por par marca só o provedor certo (mesmo id em Zen e OpenAI)', async () => {
    useAppStore.setState({ favorites: [`${OPENAI}:gpt-6.1-sol`] });
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    expect(
      within(screen.getByRole('listbox')).getByRole('button', {
        name: 'Remover GPT-6.1 Sol dos favoritos',
      }),
    ).toBeTruthy();

    await selectProvider(user, 'Zen');
    const zenStar = within(screen.getByRole('listbox')).getByRole('button', {
      name: 'Favoritar GPT 6.1 Sol',
    });
    expect(zenStar.getAttribute('aria-pressed')).toBe('false');
  });

  it('favorito legado por id ainda marca todos os provedores que o expõem', async () => {
    useAppStore.setState({ favorites: ['gpt-6.1-sol'] });
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    expect(
      within(screen.getByRole('listbox')).getByRole('button', {
        name: 'Remover GPT-6.1 Sol dos favoritos',
      }),
    ).toBeTruthy();

    await selectProvider(user, 'Zen');
    expect(
      within(screen.getByRole('listbox')).getByRole('button', {
        name: 'Remover GPT 6.1 Sol dos favoritos',
      }),
    ).toBeTruthy();
  });

  it('alternar o favorito pelo painel de detalhes grava a chave em par', async () => {
    await renderOpenDialog();
    const user = userEvent.setup();
    await openOpenAiTab(user);

    const details = modelDetails();
    await user.click(within(details).getByRole('button', { name: 'Favoritar GPT-6.1 Sol' }));

    expect(useAppStore.getState().favorites).toContain(`${OPENAI}:gpt-6.1-sol`);
    expect(useAppStore.getState().favorites).not.toContain('gpt-6.1-sol');
  });

  it('filtro Favoritos usa a chave em par no provedor escopado', async () => {
    useAppStore.setState({ favorites: [`${OPENAI}:gpt-6.1-sol`] });
    await renderOpenDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Favoritos' }));
    // O provedor atual (Go) não tem esse favorito: nada aparece.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nenhum modelo encontrado')).toBeTruthy();

    await selectProvider(user, 'ChatGPT');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('GPT-6.1 Sol');
  });
});
