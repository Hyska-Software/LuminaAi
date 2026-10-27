// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getFileDiff: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mocks }));

import { CodeDiffView } from './CodeDiffView';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFileDiff.mockResolvedValue('@@ -1 +1 @@\n-a\n+b');
});

afterEach(cleanup);

describe('CodeDiffView', () => {
  it('renderiza o diff conhecido sem chamar a API', () => {
    render(
      <CodeDiffView
        target={{
          workspaceId: 'ws-1',
          path: 'src/app.ts',
          staged: false,
          knownDiff: '@@ -2,2 +2,2 @@\n-um\n+dois',
        }}
      />,
    );

    expect(mocks.getFileDiff).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Diff de src/app.ts' })).toBeTruthy();
    expect(screen.getByText(/\+1/)).toBeTruthy();
  });

  it('busca o diff na API quando o journal não conhece o texto', async () => {
    render(
      <CodeDiffView target={{ workspaceId: 'ws-1', path: 'novo.ts', staged: true }} />,
    );

    await waitFor(() => expect(mocks.getFileDiff).toHaveBeenCalledWith('ws-1', 'novo.ts', true));
    expect(await screen.findByRole('group', { name: 'Diff de novo.ts' })).toBeTruthy();
    expect(screen.getByText('Diff (preparado)')).toBeTruthy();
  });

  it('mostra erro honesto quando a API falha e permite recarregar', async () => {
    mocks.getFileDiff.mockRejectedValueOnce('FS_NOT_A_FILE: é um diretório');
    render(<CodeDiffView target={{ workspaceId: 'ws-1', path: 'src', staged: false }} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getAllByText(/FS_NOT_A_FILE/).length).toBeGreaterThan(0);
  });
});
