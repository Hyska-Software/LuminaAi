// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ open: vi.fn(), clients: [] as Array<{ viewOnly: boolean; scaleViewport: boolean; disconnect: ReturnType<typeof vi.fn>; dispatchEvent: (event: Event) => boolean }> }));
vi.mock('@/lib/api', () => ({ api: { computerOpenStream: mocks.open } }));
vi.mock('@novnc/novnc', () => ({ default: class extends EventTarget {
  viewOnly = false;
  scaleViewport = false;
  resizeSession = false;
  focusOnClick = false;
  disconnect = vi.fn();
  constructor() { super(); mocks.clients.push(this); }
} }));

import { PrivateDesktopViewer } from './PrivateDesktopViewer';

beforeEach(() => { mocks.clients.length = 0; mocks.open.mockReset().mockResolvedValue('ws://127.0.0.1:1234/temporary'); });
afterEach(cleanup);

describe('PrivateDesktopViewer', () => {
  it('uses a view-only connection, expands without another connection, and closes on unmount', async () => {
    const view = render(<PrivateDesktopViewer conversationId="c1" agentName="Irineu" interactive={false} busy={false} onTakeControl={vi.fn()} onReleaseControl={vi.fn()} />);
    await waitFor(() => expect(mocks.clients).toHaveLength(1));
    expect(mocks.open).toHaveBeenCalledWith('c1', false);
    expect(mocks.clients[0]?.viewOnly).toBe(true);
    mocks.clients[0]?.dispatchEvent(new Event('connect'));
    fireEvent.click(screen.getByRole('button', { name: 'Expandir desktop' }));
    expect(screen.getByRole('button', { name: 'Sair da visualização expandida' })).toBeTruthy();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.clients[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it('reconnects with an interactive connection only after takeover', async () => {
    const props = { conversationId: 'c1', agentName: 'Irineu', busy: false, onTakeControl: vi.fn(), onReleaseControl: vi.fn() };
    const view = render(<PrivateDesktopViewer {...props} interactive={false} />);
    await waitFor(() => expect(mocks.clients).toHaveLength(1));
    view.rerender(<PrivateDesktopViewer {...props} interactive />);
    await waitFor(() => expect(mocks.clients).toHaveLength(2));
    expect(mocks.clients[0]?.disconnect).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenLastCalledWith('c1', true);
    expect(mocks.clients[1]?.viewOnly).toBe(false);
  });

  it('applies the latest zoom setting when the connection opens asynchronously', async () => {
    let resolveStream: (url: string) => void = () => {};
    mocks.open.mockReturnValueOnce(new Promise<string>((resolve) => { resolveStream = resolve; }));
    render(<PrivateDesktopViewer conversationId="c1" agentName="Irineu" interactive={false} busy={false} onTakeControl={vi.fn()} onReleaseControl={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar tamanho real' }));
    resolveStream('ws://127.0.0.1:1234/temporary');
    await waitFor(() => expect(mocks.clients).toHaveLength(1));
    expect(mocks.clients[0]?.scaleViewport).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar desktop à janela' }));
    expect(mocks.clients[0]?.scaleViewport).toBe(true);
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });
});
