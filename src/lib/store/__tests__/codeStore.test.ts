import { describe, expect, it } from 'vitest';
import { applyCodeEvent, emptyCodeSession, fromSnapshot, isCodeEvent } from '../codeStore';
import type {
  ApprovalRequest,
  AskUserRequest,
  CodeSessionState,
  ContextStats,
  FileChange,
  JobView,
  TurnEvent,
} from '../../types';

function approval(id = 'apr-1'): ApprovalRequest {
  return {
    id,
    toolCallId: 'call-1',
    tool: 'run_command',
    title: 'Executar comando?',
    detail: { kind: 'command', command: 'npm test', workdir: '.' },
    risk: 'shell',
    options: [{ id: 'allow', label: 'Permitir' }],
    createdAt: 1,
  };
}

function context(used = 10_000): ContextStats {
  return { used, window: 200_000, outputCap: 32_000, percent: used / 2_000 };
}

function job(status: JobView['status'] = 'running'): JobView {
  return {
    id: 'job-1',
    command: 'npm run dev',
    status,
    startedAt: 1,
    durationMs: status === 'running' ? 100 : 900,
  };
}

describe('codeStore reducer', () => {
  it('tracks pending approvals and resolutions', () => {
    let state = emptyCodeSession('conv-1');
    state = applyCodeEvent(state, { type: 'approval_requested', approval: approval() });
    expect(state.approvals).toHaveLength(1);
    state = applyCodeEvent(state, {
      type: 'approval_resolved',
      approvalId: 'apr-1',
      decision: 'approved',
      scope: 'workspace',
    });
    expect(state.approvals).toHaveLength(0);
    expect(state.resolutions['apr-1']).toEqual({ decision: 'approved', scope: 'workspace' });
  });

  it('replaces the whole todo list and plan state', () => {
    let state = emptyCodeSession('conv-1');
    state = applyCodeEvent(state, {
      type: 'todos_updated',
      todos: [{ content: 'Editar a.ts', status: 'in_progress' }],
    });
    expect(state.todos).toEqual([{ content: 'Editar a.ts', status: 'in_progress' }]);
    state = applyCodeEvent(state, {
      type: 'plan_updated',
      plan: { state: 'reviewing', markdown: '# Plano', updatedAt: 2 },
    });
    expect(state.plan?.state).toBe('reviewing');
    expect(state.planMode).toBe(true);
    state = applyCodeEvent(state, {
      type: 'plan_updated',
      plan: { state: 'approved', markdown: '# Plano', updatedAt: 3 },
    });
    expect(state.planMode).toBe(false);
  });

  it('accumulates file changes and replaces them on the turn summary', () => {
    let state = emptyCodeSession('conv-1');
    const change = (path: string, added: number, removed: number): FileChange => ({
      path,
      kind: 'modified',
      added,
      removed,
    });
    state = applyCodeEvent(state, { type: 'file_changed', change: change('a.ts', 3, 1) });
    state = applyCodeEvent(state, { type: 'file_changed', change: change('b.ts', 2, 0) });
    expect(state.changes?.files).toHaveLength(2);
    expect(state.changes?.added).toBe(5);
    expect(state.changes?.removed).toBe(1);
    state = applyCodeEvent(state, {
      type: 'workspace_changes',
      summary: { turnId: 't1', files: [], added: 0, removed: 0 },
    });
    expect(state.changes?.files).toHaveLength(0);
  });

  it('updates context, compaction and jobs', () => {
    let state = emptyCodeSession('conv-1');
    state = applyCodeEvent(state, { type: 'context_stats', stats: context(50_000) });
    expect(state.context?.used).toBe(50_000);
    state = applyCodeEvent(state, { type: 'compacted', messages: 20, tokensFreed: 30_000 });
    expect(state.context?.compacted).toBe(1);
    expect(state.context?.used).toBe(20_000);
    state = applyCodeEvent(state, { type: 'job_updated', job: job('running') });
    expect(state.jobs).toHaveLength(1);
    state = applyCodeEvent(state, { type: 'job_updated', job: job('done') });
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].status).toBe('done');
  });

  it('mirrors profile changes and ignores chat events', () => {
    let state = emptyCodeSession('conv-1');
    state = applyCodeEvent(state, {
      type: 'profile_changed',
      profile: 'code',
      permissionMode: 'autonomous',
      planMode: true,
    });
    expect(state.permissionMode).toBe('autonomous');
    expect(state.planMode).toBe(true);
    const textEvent: TurnEvent = { type: 'text_delta', delta: 'oi' };
    expect(isCodeEvent(textEvent)).toBe(false);
    expect(applyCodeEvent(state, textEvent)).toBe(state);
  });

  it('tracks pending questions and the answers resolved by the card', () => {
    const request: AskUserRequest = {
      id: 'ask-1',
      conversationId: 'conv-1',
      toolCallId: 'call-1',
      questions: [
        {
          id: 'db',
          question: 'Qual banco devo usar?',
          options: [{ label: 'SQLite' }, { label: 'Postgres' }],
          multiSelect: false,
        },
      ],
      createdAt: 1,
    };
    let state = emptyCodeSession('conv-1');
    state = applyCodeEvent(state, { type: 'question_requested', request });
    expect(state.questions).toHaveLength(1);
    state = applyCodeEvent(state, {
      type: 'question_resolved',
      requestId: 'ask-1',
      answers: [{ questionId: 'db', selected: ['SQLite'], custom: null }],
      skipped: false,
    });
    expect(state.questions).toHaveLength(0);
    expect(state.questionAnswers['ask-1'].answers[0].selected).toEqual(['SQLite']);
    expect(state.questionAnswers['ask-1'].skipped).toBe(false);
    expect(isCodeEvent({ type: 'question_requested', request })).toBe(true);
  });
  it('restores the authoritative snapshot from the backend', () => {
    const snapshot: CodeSessionState = {
      conversationId: 'conv-1',
      permissionMode: 'read_only',
      planMode: false,
      plan: null,
      todos: [],
      workspace: null,
      context: context(1_000),
      changes: null,
      jobs: [],
      approvals: [],
    };
    const previous = { ...emptyCodeSession('conv-1'), approvals: [approval()] };
    const next = fromSnapshot(snapshot, previous);
    expect(next.permissionMode).toBe('read_only');
    expect(next.loading).toBe(false);
    expect(next.context?.used).toBe(1_000);
    // resoluções de UI sobrevivem ao snapshot
    expect(next.resolutions).toBe(previous.resolutions);
  });
});
