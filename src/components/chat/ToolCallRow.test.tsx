// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bot } from 'lucide-react';
import type { ToolCallRecord } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  toolImagePreview: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { info: mocks.info, error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ api: { toolImagePreview: mocks.toolImagePreview } }));

import { useUiStore } from '@/lib/store';
import { ToolCallRow } from './ToolCallRow';

function taskTool(): ToolCallRecord {
  return {
    id: 'task-1',
    name: 'task',
    arguments: JSON.stringify({
      description: 'Revisar o diff',
      prompt: 'Aponte bugs',
    }),
    status: 'done',
    result: 'Achei um bug.',
    summary: 'Subagente review: Revisar o diff',
    presentation: {
      kind: 'subagent',
      description: 'Revisar o diff',
      subagentType: 'review',
      conversationId: 'child-1',
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      effort: 'high',
      steps: 3,
      durationMs: 1200,
    },
  };
}

describe('ToolCallRow subagent chat tab', () => {
  afterEach(() => {
    cleanup();
    mocks.info.mockReset();
    useUiStore.setState({
      codeSubagentTabs: [],
      codeSubagentTab: null,
      codeView: 'session',
    });
  });

  it('opens the subagent chat tab and warns instead of duplicating it', () => {
    render(<ToolCallRow tool={taskTool()} icon={Bot} />);
    const button = screen.getByRole('button', { name: /Abrir chat/i });

    fireEvent.click(button);

    let state = useUiStore.getState();
    expect(state.codeView).toBe('subagent');
    expect(state.codeSubagentTabs).toHaveLength(1);
    expect(state.codeSubagentTab).toMatchObject({
      conversationId: 'child-1',
      taskCallId: 'task-1',
      subagentType: 'review',
      prompt: 'Aponte bugs',
    });

    fireEvent.click(button);
    state = useUiStore.getState();
    expect(state.codeSubagentTabs).toHaveLength(1);
    expect(mocks.info).toHaveBeenCalledWith('Este subagente já está aberto em uma aba.');
  });

  it('renders persisted tool screenshots from the app-data folder', async () => {
    mocks.toolImagePreview.mockResolvedValue('data:image/jpeg;base64,abc');
    const tool: ToolCallRecord = {
      id: 'shot-1',
      name: 'computer_screenshot',
      arguments: '{}',
      status: 'done',
      result: '{"width":1440,"height":900}',
      summary: 'Screenshot 1440×900',
      images: [{ mimeType: 'image/jpeg', path: 'C:/app/tool-images/shot.jpg' }],
    };
    render(<ToolCallRow tool={tool} icon={Bot} />);

    fireEvent.click(screen.getAllByRole('button')[0]);
    const image = await screen.findByAltText('Screenshot retornado pela tool (1)');
    expect(image.getAttribute('src')).toBe('data:image/jpeg;base64,abc');
    expect(mocks.toolImagePreview).toHaveBeenCalledWith(
      'C:/app/tool-images/shot.jpg',
    );
  });
});
