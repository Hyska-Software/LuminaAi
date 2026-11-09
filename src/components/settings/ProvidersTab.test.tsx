// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({
  setProviderKey: vi.fn(),
  validateProvider: vi.fn(),
  openaiLoginStart: vi.fn(),
  openaiLoginWait: vi.fn(),
  openaiLoginCancel: vi.fn(),
  openaiSignOut: vi.fn(),
  openaiAuthStatus: vi.fn(),
  getSettings: vi.fn(),
  refreshProviderModels: vi.fn(),
  openDataDir: vi.fn(),
  openExternal: vi.fn(),
  copyText: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    setProviderKey: mocks.setProviderKey,
    validateProvider: mocks.validateProvider,
    openaiLoginStart: mocks.openaiLoginStart,
    openaiLoginWait: mocks.openaiLoginWait,
    openaiLoginCancel: mocks.openaiLoginCancel,
    openaiSignOut: mocks.openaiSignOut,
    openaiAuthStatus: mocks.openaiAuthStatus,
    getSettings: mocks.getSettings,
    refreshProviderModels: mocks.refreshProviderModels,
    openDataDir: mocks.openDataDir,
  },
}));

vi.mock('@/lib/genui/open-external', () => ({
  openExternal: mocks.openExternal,
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, copyText: mocks.copyText };
});

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// Imported after the mocks above.
import { ProvidersTab } from '@/components/settings/ProvidersTab';
import { catalog } from '@/lib/catalog';
import type { LoginChallenge, ProviderAuthStatus, ProviderKeyStatus } from '@/lib/types';
import { useAppStore } from '@/lib/store';

afterEach(() => cleanup());

const GO = 'opencode-go';
const ZEN = 'opencode-zen';
const OPENAI = 'openai';
const ANTHROPIC = 'anthropic';

const GO_KEY: ProviderKeyStatus = { providerId: GO, hasKey: true, source: 'settings', masked: 'sk-…go01' };
const ZEN_KEY: ProviderKeyStatus = { providerId: ZEN, hasKey: true, source: 'settings', masked: 'sk-…zen1' };
const OPENAI_NO_KEY: ProviderKeyStatus = { providerId: OPENAI, hasKey: false, source: 'none' };
const ANTHROPIC_NO_KEY: ProviderKeyStatus = {
  providerId: ANTHROPIC,
  hasKey: false,
  source: 'none',
};

/** Fresh copy of the key-status fixtures used by the mocked settings views. */
function defaultKeys(): ProviderKeyStatus[] {
  return [GO_KEY, ZEN_KEY, OPENAI_NO_KEY, ANTHROPIC_NO_KEY];
}

const CHALLENGE: LoginChallenge = {
  attemptId: 'attempt-1',
  authUrl: 'https://auth.openai.com/api/accounts/authorize?state=abc',
  expiresAt: Date.now() + 10 * 60_000,
  browserOpened: true,
  browserError: null,
};

const SIGNED_IN: ProviderAuthStatus = {
  providerId: OPENAI,
  mode: 'oauth',
  state: 'signed-in',
  accountLabel: 'user@example.com',
  planUsage: true,
  expiresAt: Date.now() + 3_600_000,
  scopes: ['openid', 'profile', 'email', 'offline_access', 'chatgpt.tokens.use.direct'],
  clientIdMasked: 'oaiapp_…1234',
  hostIdMasked: 'urn:uuid:…5678',
  hint: null,
};

function signedInStatus(overrides: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus {
  return { ...SIGNED_IN, ...overrides };
}

function settingsView(keys: ProviderKeyStatus[], auth: ProviderAuthStatus[] = []) {
  return { settings: useAppStore.getState().settings, keys, auth };
}

function providerSection(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name });
  return heading.closest('section') as HTMLElement;
}

function openAiSection(): HTMLElement {
  return providerSection('OpenAI (ChatGPT)');
}

async function renderTab() {
  render(<ProvidersTab />);
  return screen.getByRole('heading', { level: 3, name: 'OpenAI (ChatGPT)' });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.validateProvider.mockResolvedValue({
    providerId: GO,
    ok: true,
    latencyMs: 12,
    models: 27,
  });
  mocks.openaiAuthStatus.mockResolvedValue([]);
  mocks.copyText.mockResolvedValue(true);
  mocks.refreshProviderModels.mockResolvedValue({
    catalog,
    keys: defaultKeys(),
    auth: [],
  });
  mocks.setProviderKey.mockImplementation(async (providerId: string, key: string | null) => {
    const nextKeys: ProviderKeyStatus[] = defaultKeys().map((entry) =>
      entry.providerId === providerId
        ? {
            ...entry,
            hasKey: key != null,
            source: key != null ? 'settings' : 'none',
            masked: key != null ? 'sk-…novo' : null,
          }
        : entry,
    );
    return settingsView(nextKeys);
  });
  mocks.getSettings.mockImplementation(async () => settingsView(defaultKeys()));
  useAppStore.setState({
    providers: catalog.providers,
    keys: defaultKeys(),
    auth: [],
    secretsError: null,
    error: null,
    loginChallenge: null,
  });
});

describe('ProvidersTab — cards de provedor', () => {
  it('mantém o comportamento de API key do Go e do Zen', async () => {
    // O Zen fica sem chave para exercitar o placeholder do OpenCode Console.
    useAppStore.setState({
      keys: [
        GO_KEY,
        { providerId: ZEN, hasKey: false, source: 'none' },
        OPENAI_NO_KEY,
        ANTHROPIC_NO_KEY,
      ],
    });
    await renderTab();
    const user = userEvent.setup();

    const go = providerSection('OpenCode Go');
    const zen = providerSection('OpenCode Zen');

    // Both keep the exact API-key form (no ChatGPT flow inside them).
    expect(within(go).getByLabelText('API key de OpenCode Go')).toBeTruthy();
    expect(within(zen).getByLabelText('API key de OpenCode Zen')).toBeTruthy();
    expect(within(go).queryByRole('button', { name: /Continuar com ChatGPT/ })).toBeNull();
    expect(within(zen).queryByRole('button', { name: /Continuar com ChatGPT/ })).toBeNull();
    expect(within(go).getByText('Configurada')).toBeTruthy();
    // Com chave salva o campo pede substituição; sem chave cita o console do OpenCode.
    expect(
      (within(go).getByLabelText('API key de OpenCode Go') as HTMLInputElement).placeholder,
    ).toBe('Colar nova chave para substituir…');
    expect(
      (within(zen).getByLabelText('API key de OpenCode Zen') as HTMLInputElement).placeholder,
    ).toBe('Colar API key do OpenCode Console…');

    const input = within(go).getByLabelText('API key de OpenCode Go');
    await user.type(input, 'sk-go-nova');
    await user.click(within(go).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mocks.setProviderKey).toHaveBeenCalledWith(GO, 'sk-go-nova');
    });
  });

  it('OpenAI sem login oferece Continuar com ChatGPT e a alternativa de API key', async () => {
    await renderTab();
    const user = userEvent.setup();
    const section = openAiSection();

    expect(within(section).getByRole('button', { name: /Continuar com ChatGPT/ })).toBeTruthy();
    expect(within(section).getByText(/o limite é compartilhado/i)).toBeTruthy();
    expect(within(section).queryByLabelText('API key de OpenAI (ChatGPT)')).toBeNull();

    await user.click(within(section).getByRole('button', { name: 'Usar API key' }));

    const input = within(section).getByLabelText('API key de OpenAI (ChatGPT)') as HTMLInputElement;
    expect(input.placeholder).toBe('Colar API key da OpenAI…');
    await user.type(input, 'sk-openai-123');
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mocks.setProviderKey).toHaveBeenCalledWith(OPENAI, 'sk-openai-123');
    });
  });

  it('dois fases do login: aguardando o navegador, copiar/reabrir link e cancelar', async () => {
    mocks.openaiLoginStart.mockResolvedValue(CHALLENGE);
    // Keeps the wait pending so the UI stays in the two-phase "awaiting" state.
    mocks.openaiLoginWait.mockReturnValue(new Promise(() => {}));
    mocks.openaiLoginCancel.mockResolvedValue(undefined);
    await renderTab();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Continuar com ChatGPT/ }));

    await screen.findByText('Aguardando o navegador…');
    expect(mocks.openaiLoginStart).toHaveBeenCalledWith(OPENAI, false);
    expect(useAppStore.getState().loginChallenge?.attemptId).toBe('attempt-1');
    expect(screen.queryByText('O navegador não abriu automaticamente')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Copiar link/ }));
    expect(mocks.copyText).toHaveBeenCalledWith(CHALLENGE.authUrl);
    expect(await screen.findByRole('button', { name: /Link copiado/ })).toBeTruthy();

    // The raw URL stays available even when the clipboard is unavailable.
    await user.click(screen.getByText('Mostrar link de login'));
    expect(screen.getByText(CHALLENGE.authUrl)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Abrir novamente/ }));
    expect(mocks.openExternal).toHaveBeenCalledWith(CHALLENGE.authUrl);

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(mocks.openaiLoginCancel).toHaveBeenCalledWith('attempt-1'));
    await waitFor(() => expect(screen.queryByText('Aguardando o navegador…')).toBeNull());
  });

  it('quando o navegador não abre, avisa e prioriza o link copiável', async () => {
    mocks.openaiLoginStart.mockResolvedValue({
      ...CHALLENGE,
      browserOpened: false,
      browserError: 'Launcher "xdg-open" failed with exit status: 3',
    });
    mocks.openaiLoginWait.mockReturnValue(new Promise(() => {}));
    await renderTab();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Continuar com ChatGPT/ }));

    expect(await screen.findByText('O navegador não abriu automaticamente')).toBeTruthy();
    expect(screen.getByText(/xdg-open/)).toBeTruthy();
    // The copy button becomes the primary action in this state.
    expect(
      (screen.getByRole('button', { name: /Copiar link/ }) as HTMLButtonElement).className,
    ).toContain('bg-foreground');

    await user.click(screen.getByRole('button', { name: /Copiar link/ }));
    expect(mocks.copyText).toHaveBeenCalledWith(CHALLENGE.authUrl);
  });

  it('falha ao copiar mantém o estado pendente e reporta o erro', async () => {
    mocks.openaiLoginStart.mockResolvedValue(CHALLENGE);
    mocks.openaiLoginWait.mockReturnValue(new Promise(() => {}));
    mocks.copyText.mockResolvedValue(false);
    await renderTab();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Continuar com ChatGPT/ }));
    await screen.findByText('Aguardando o navegador…');

    await user.click(screen.getByRole('button', { name: /Copiar link/ }));
    expect(screen.getByRole('button', { name: /Copiar link/ })).toBeTruthy();
    expect(screen.getByText('Aguardando o navegador…')).toBeTruthy();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Não foi possível copiar o link',
      expect.anything(),
    );
  });

  it('conta conectada: e-mail, selo, detalhes, Gerenciar uso e Sair', async () => {
    useAppStore.setState({ auth: [signedInStatus()] });
    mocks.openaiSignOut.mockResolvedValue(signedInStatus({ state: 'signed-out', planUsage: false }));
    mocks.openaiAuthStatus.mockResolvedValue([]);
    await renderTab();
    const user = userEvent.setup();
    const section = openAiSection();

    expect(within(section).getByText('user@example.com')).toBeTruthy();
    expect(within(section).getByText('Plano ChatGPT')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Continuar com ChatGPT/ })).toBeNull();

    // Collapsible account details (masked ids/scopes/expiry — never tokens).
    await user.click(within(section).getByText('Detalhes da conta'));
    expect(within(section).getByText('oaiapp_…1234')).toBeTruthy();
    expect(within(section).getByText('urn:uuid:…5678')).toBeTruthy();
    expect(within(section).getByText(/chatgpt\.tokens\.use\.direct/)).toBeTruthy();

    await user.click(within(section).getByRole('button', { name: /Gerenciar uso/ }));
    expect(mocks.openExternal).toHaveBeenCalledWith('https://chatgpt.com/settings/usage');

    await user.click(within(section).getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(mocks.openaiSignOut).toHaveBeenCalledWith(OPENAI));
  });

  it('plano desativado pede consentimento explícito', async () => {
    useAppStore.setState({
      auth: [signedInStatus({ state: 'plan-disabled', planUsage: false })],
    });
    mocks.openaiLoginStart.mockResolvedValue(CHALLENGE);
    mocks.openaiLoginWait.mockReturnValue(new Promise(() => {}));
    await renderTab();
    const user = userEvent.setup();
    const section = openAiSection();

    expect(within(section).getByText(/uso do plano ChatGPT não está ativado/i)).toBeTruthy();
    await user.click(within(section).getByRole('button', { name: 'Ativar uso do plano' }));

    await waitFor(() => expect(mocks.openaiLoginStart).toHaveBeenCalledWith(OPENAI, true));
  });

  it('sessão expirada mostra Conectar novamente', async () => {
    useAppStore.setState({
      auth: [signedInStatus({ state: 'reauth-required', planUsage: false, hint: 'Entre novamente.' })],
    });
    mocks.openaiLoginStart.mockResolvedValue(CHALLENGE);
    mocks.openaiLoginWait.mockReturnValue(new Promise(() => {}));
    await renderTab();
    const user = userEvent.setup();
    const section = openAiSection();

    expect(within(section).getByText('Sessão do ChatGPT expirada')).toBeTruthy();
    await user.click(within(section).getByRole('button', { name: 'Conectar novamente' }));

    await waitFor(() => expect(mocks.openaiLoginStart).toHaveBeenCalledWith(OPENAI, false));
  });

  it('mostra o aviso de primeiro login uma única vez', async () => {
    mocks.openaiLoginStart.mockResolvedValue(CHALLENGE);
    mocks.openaiLoginWait.mockResolvedValue(signedInStatus());
    mocks.openaiAuthStatus.mockResolvedValue([signedInStatus()]);
    await renderTab();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Continuar com ChatGPT/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Você está usando seu plano ChatGPT')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Entendi' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem('lumina.openaiPlanNoticeShown')).toBe('1');

    // A fresh mount reads the persisted flag and never shows the notice again.
    cleanup();
    const second = userEvent.setup();
    useAppStore.setState({
      auth: [],
      loginChallenge: null,
      keys: defaultKeys(),
    });
    render(<ProvidersTab />);
    await second.click(screen.getByRole('button', { name: /Continuar com ChatGPT/ }));
    await waitFor(() => expect(mocks.openaiLoginStart).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('não renderiza material de credencial mesmo se o status trouxer campos extras', async () => {
    const hostile = {
      ...signedInStatus(),
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.accesso.secret',
      refreshToken: 'rt-secret',
      idToken: 'id-secret',
      access_token: 'snake-secret',
    } as unknown as ProviderAuthStatus;
    useAppStore.setState({ auth: [hostile] });
    await renderTab();
    const user = userEvent.setup();

    await user.click(within(openAiSection()).getByText('Detalhes da conta'));

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(text).not.toContain('rt-secret');
    expect(text).not.toContain('id-secret');
    expect(text).not.toContain('snake-secret');
    expect(text).toContain('oaiapp_…1234');
  });

  it('card Anthropic permanece só API key (sem ChatGPT) e usa o console da Anthropic', async () => {
    mocks.validateProvider.mockResolvedValue({
      providerId: ANTHROPIC,
      ok: true,
      latencyMs: 8,
      models: 14,
    });
    await renderTab();
    const user = userEvent.setup();
    const section = providerSection('Anthropic');

    // Generic API-key card: provider metadata only, no ChatGPT account UI.
    expect(within(section).getByText(/API oficial da Anthropic/)).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Continuar com ChatGPT/ })).toBeNull();
    expect(within(section).queryByText(/ChatGPT/)).toBeNull();
    expect(within(section).queryByText('Plano ChatGPT')).toBeNull();
    expect(within(section).getByText('Chave ausente')).toBeTruthy();

    const input = within(section).getByLabelText('API key de Anthropic') as HTMLInputElement;
    expect(input.placeholder).toBe('Colar API key da Anthropic (sk-ant-…)…');

    // Console button opens the provider's own console (not the OpenCode one).
    await user.click(within(section).getByRole('button', { name: 'Console' }));
    expect(mocks.openExternal).toHaveBeenCalledWith('https://platform.claude.com/settings/keys');

    // Saving stores the key under the anthropic provider id.
    await user.type(input, 'sk-ant-api03-teste-1234567890');
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(mocks.setProviderKey).toHaveBeenCalledWith(
        ANTHROPIC,
        'sk-ant-api03-teste-1234567890',
      ),
    );

    // "Testar conexão" validates the anthropic provider.
    await user.click(within(section).getByRole('button', { name: 'Testar conexão' }));
    await waitFor(() => expect(mocks.validateProvider).toHaveBeenCalledWith(ANTHROPIC));
  });

  it('mostra o aviso de secrets.json inválido sem ação destrutiva', async () => {
    useAppStore.setState({ secretsError: 'expected value at line 1 column 1' });
    mocks.openDataDir.mockResolvedValue(undefined);
    await renderTab();
    const user = userEvent.setup();

    expect(screen.getByText(/Não foi possível ler o arquivo de segredos/)).toBeTruthy();
    expect(screen.getByText(/expected value at line 1 column 1/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Abrir pasta de dados/ }));
    await waitFor(() => expect(mocks.openDataDir).toHaveBeenCalled());
  });

  it('mostra os erros do store em linha e permite dispensá-los', async () => {
    useAppStore.setState({ error: 'Falha ao salvar a chave' });
    await renderTab();
    const user = userEvent.setup();

    expect(screen.getByText('A última ação falhou')).toBeTruthy();
    expect(screen.getByText('Falha ao salvar a chave')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(useAppStore.getState().error).toBeNull();
    await waitFor(() => expect(screen.queryByText('A última ação falhou')).toBeNull());
  });
});
