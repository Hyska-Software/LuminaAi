// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui';
import { ModelPill } from '@/components/models/ModelPill';
import { useAppStore } from '@/lib/store';

afterEach(() => cleanup());

function renderPill(element: React.ReactElement): string {
  return renderToStaticMarkup(<TooltipProvider>{element}</TooltipProvider>);
}

function renderInteractive(element: React.ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

async function openModelList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Selecionar modelo/ }));
}

describe('ModelPill (closed state)', () => {
  it('shows the current model and the thinking label', () => {
    const html = renderPill(<ModelPill providerId="opencode-go" modelId="deepseek-v4.1-flash" />);
    expect(html).toContain('DeepSeek V4.1 Flash');
    expect(html).toContain('Selecionar modelo');
    expect(html).toContain('Selecionar modo de pensamento');
    expect(html).toContain('Alto');
  });

  it('does not render the full-picker button or the model list in the closed pill', () => {
    const html = renderPill(<ModelPill providerId="opencode-go" modelId="deepseek-v4.1-flash" />);
    // The full dialog entry point lives inside the model list now.
    expect(html).not.toContain('Abrir seletor completo');
    expect(html).not.toContain('Ver todos os modelos');
  });

  it('shows the selected effort short label', () => {
    const html = renderPill(
      <ModelPill
        providerId="opencode-go"
        modelId="deepseek-v4.1-flash"
        reasoning={{ mode: 'effort', effort: 'max' }}
      />,
    );
    expect(html).toContain('Máximo');
  });

  it('marks models without reasoning control', () => {
    const html = renderPill(
      <ModelPill providerId="opencode-go" modelId="mimo-v2.6-flash" reasoning={null} />,
    );
    expect(html).toContain('Sem controle');
  });

  it('renders the compact variant', () => {
    const html = renderPill(<ModelPill providerId="opencode-go" modelId="glm-5.3-flash" compact />);
    expect(html).toContain('GLM-5.3-Flash');
  });
});

describe('ModelPill (interactions)', () => {
  beforeEach(() => {
    // Interactions update the store (like the real app, where the pill has no
    // props and reads/writes the current selection).
    useAppStore.setState({
      selection: {
        providerId: 'opencode-go',
        modelId: 'deepseek-v4.1-flash',
        reasoning: { mode: 'effort', effort: 'high' },
      },
    });
  });

  it('opens the model dropdown and shows model details on hover', async () => {
    const user = userEvent.setup();
    renderInteractive(<ModelPill />);

    await openModelList(user);

    expect(await screen.findByText('Modelos')).toBeTruthy();
    expect(screen.getByText('DeepSeek')).toBeTruthy();
    expect(screen.getByText('GLM')).toBeTruthy();
    expect(screen.getByText('Ver todos os modelos…')).toBeTruthy();

    // Details are hidden until a model is hovered.
    expect(screen.queryByText('Contexto')).toBeNull();

    const glmItem = await screen.findByRole('menuitem', { name: /GLM-5.3-Flash/ });
    await user.hover(glmItem);
    await waitFor(() => {
      expect(screen.getByText('GLM-5.3-Flash', { selector: 'p' })).toBeTruthy();
      const line = screen.getByText('Protocolo').closest('dl');
      expect(line?.textContent).toContain('OpenAI Chat');
    });

    // Leaving the list hides the details panel again.
    const menu = screen.getByLabelText('Selecionar modelo');
    fireEvent.pointerLeave(menu.firstElementChild as Element);
    await waitFor(() => {
      expect(screen.queryByText('Contexto')).toBeNull();
    });
  });

  it('keeps the details in sync while hovering different models', async () => {
    const user = userEvent.setup();
    renderInteractive(<ModelPill />);
    await openModelList(user);

    const claudeItem = await screen.findByRole('menuitem', { name: /Claude Haiku 5.5/ });
    await user.hover(claudeItem);
    await waitFor(() => {
      expect(screen.getByText('Claude Haiku 5.5', { selector: 'p' })).toBeTruthy();
    });

    const deepseekItem = await screen.findByRole('menuitem', { name: /DeepSeek V4.1 Flash/ });
    await user.hover(deepseekItem);
    await waitFor(() => {
      expect(screen.getByText('DeepSeek V4.1 Flash', { selector: 'p' })).toBeTruthy();
      expect(screen.queryByText('Claude Haiku 5.5', { selector: 'p' })).toBeNull();
    });
  });

  it('switches the same dropdown to the thinking list after selecting a model', async () => {
    const user = userEvent.setup();
    renderInteractive(<ModelPill />);

    await openModelList(user);
    await user.click(await screen.findByRole('menuitem', { name: /GLM-5.3-Flash/ }));

    // Model list gives way to the thinking list inside the same dropdown.
    expect(await screen.findByText('Modo de pensamento')).toBeTruthy();
    expect(screen.queryByText('Ver todos os modelos…')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Baixo/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Máximo/ })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: /Máximo/ }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /Selecionar modo de pensamento\. Atual: Máximo/,
        }),
      ).toBeTruthy();
    });
  });

  it('opens the thinking list directly from the effort label', async () => {
    const user = userEvent.setup();
    renderInteractive(<ModelPill />);

    await user.click(screen.getByRole('button', { name: /Selecionar modo de pensamento/ }));

    expect(await screen.findByText('Modo de pensamento')).toBeTruthy();
    expect(screen.queryByText('Ver todos os modelos…')).toBeNull();
    // The back button returns to the model list without closing the dropdown.
    await user.click(screen.getByRole('button', { name: /Voltar para a lista de modelos/ }));
    expect(await screen.findByText('Ver todos os modelos…')).toBeTruthy();
  });

  it('opens the full dialog from the list footer', async () => {
    const user = userEvent.setup();
    const onOpenFullPicker = vi.fn();
    renderInteractive(<ModelPill onClick={onOpenFullPicker} />);

    await openModelList(user);
    await user.click(await screen.findByRole('menuitem', { name: /Ver todos os modelos/ }));

    expect(onOpenFullPicker).toHaveBeenCalledTimes(1);
  });
});
