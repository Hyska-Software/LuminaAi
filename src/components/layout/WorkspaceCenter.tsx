import { AgentWorkspace } from '@/components/agents/AgentWorkspace';
import { ChatView } from '@/components/chat/ChatView';
import { SubagentChatView } from '@/components/agent/SubagentChatView';
import {
  CodeCommitHistoryView,
  CodeDiffView,
  CodeFileView,
  CodePlanView,
  CodeSessionHeader,
  CodeWelcomeScreen,
  GoalDialog,
  GoalPanel,
} from '@/components/code';
import { LibraryView } from '@/components/library';
import { SkillsView } from '@/components/skills';
import { useChatStore, useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * Center column of the application shell.
 *
 * The Chat and Code layouts share the exact same `ChatView` instance (and its
 * `Composer`), so switching layouts keeps the draft, attachments and scroll
 * position (docs/goals/chat-code-layout/PLAN.md §3.3). Only the chrome around
 * it changes: the Code session header/tabs are inserted above the conversation,
 * and each layout has its own page state (Chat: `activeView`, Code: `codeView`).
 *
 * Biblioteca (`library`) only exists in the Chat layout — the Code workbench
 * deliberately has no library page (PLAN §3.2/§3.5).
 */
export function WorkspaceCenter() {
  const layoutMode = useUiStore((state) => state.layoutMode);
  const codeView = useUiStore((state) => state.codeView);
  const codeDiffTab = useUiStore((state) => state.codeDiffTab);
  const codeFileTab = useUiStore((state) => state.codeFileTab);
  const codePlanTab = useUiStore((state) => state.codePlanTab);
  const codeCommitsTab = useUiStore((state) => state.codeCommitsTab);
  const codeSubagentTab = useUiStore((state) => state.codeSubagentTab);
  const selectCodeCommit = useUiStore((state) => state.selectCodeCommit);
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const setCodeView = useUiStore((state) => state.setCodeView);
  const goalDialog = useUiStore((state) => state.goalDialog);
  const closeGoalDialog = useUiStore((state) => state.closeGoalDialog);
  /** Sessão ativa no Code (dona do objetivo exibido no painel central). */
  const activeId = useChatStore((state) => state.activeId);

  if (layoutMode === 'agent') return <AgentWorkspace />;

  const isCode = layoutMode === 'code';
  const showSkills = isCode ? codeView === 'skills' : activeView === 'skills';
  const showLibrary = !isCode && activeView === 'library';
  const showDiff = isCode && codeView === 'diff' && codeDiffTab !== null;
  const showFile = isCode && codeView === 'file' && codeFileTab !== null;
  const showPlan = isCode && codeView === 'plan' && codePlanTab !== null;
  const showGoal = isCode && codeView === 'goal' && activeId !== null;
  const showCommits = isCode && codeView === 'commits' && codeCommitsTab !== null;
  const showSubagent = isCode && codeView === 'subagent' && codeSubagentTab !== null;
  const showChat =
    !showSkills &&
    !showLibrary &&
    !showDiff &&
    !showCommits &&
    !showFile &&
    !showPlan &&
    !showGoal &&
    !showSubagent;
  const showHeader =
    isCode &&
    (showChat ||
      showDiff ||
      showCommits ||
      showFile ||
      showPlan ||
      showGoal ||
      showSubagent);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Stable wrapper: the conversation below keeps its DOM position across
          layout switches (see `aria-controls` of the Code session tabs). The
          header stays mounted while the Code Skills page is open so the open
          session tabs are not lost when coming back (PLAN §3.3), and stays
          visible above the central tabs of diff/commits/file (WORKBENCH §7). */}
      <div
        className={cn('shrink-0', !showHeader && 'hidden')}
        aria-hidden={isCode && !showHeader ? true : undefined}
        inert={isCode && !showHeader ? true : undefined}
      >
        {isCode ? <CodeSessionHeader /> : null}
      </div>

      <div
        id="code-session-panel"
        role="region"
        aria-label="Conversa"
        className={cn('min-h-0 flex-1 flex-col', showChat ? 'flex' : 'hidden')}
      >
        <ChatView welcome={isCode ? <CodeWelcomeScreen /> : undefined} />
      </div>

      {showSubagent && codeSubagentTab ? (
        <div
          id="code-subagent-panel"
          role="region"
          aria-label={`Subagente ${codeSubagentTab.description}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SubagentChatView target={codeSubagentTab} />
        </div>
      ) : null}

      {showCommits && codeCommitsTab ? (
        <div
          id="code-commits-panel"
          role="region"
          aria-label="Histórico de commits"
          className="flex min-h-0 flex-1 flex-col"
        >
          <CodeCommitHistoryView target={codeCommitsTab} onSelect={selectCodeCommit} />
        </div>
      ) : null}

      {showDiff && codeDiffTab ? (
        <div
          id="code-diff-panel"
          role="region"
          aria-label={`Diff de ${codeDiffTab.path}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          <CodeDiffView target={codeDiffTab} className="flex min-h-0 flex-1 flex-col" />
        </div>
      ) : null}

      {showFile && codeFileTab ? (
        <div
          id="code-file-panel"
          role="region"
          aria-label={`Arquivo ${codeFileTab.path}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          <CodeFileView target={codeFileTab} className="flex min-h-0 flex-1 flex-col" />
        </div>
      ) : null}

      {showPlan && codePlanTab ? (
        <div
          id="code-plan-panel"
          role="region"
          aria-label="Plano aprovado da sessão"
          className="flex min-h-0 flex-1 flex-col"
        >
          <CodePlanView tab={codePlanTab} className="flex min-h-0 flex-1 flex-col" />
        </div>
      ) : null}

      {/* Objetivo persistente da sessão (docs/goals/code-goals/PLAN.md §10.3):
          o `GoalPanel` é dono da region/id (`code-goal-panel`) e do scroll; aqui
          ele só ocupa o centro no lugar da conversa. */}
      {showGoal && activeId ? <GoalPanel conversationId={activeId} /> : null}

      {showSkills ? (
        <SkillsView
          onBack={() => (isCode ? setCodeView('session') : setActiveView('chat'))}
          backLabel={isCode ? 'Voltar à sessão' : 'Voltar ao chat'}
        />
      ) : null}

      {showLibrary ? <LibraryView /> : null}

      {/* Diálogo de criação/edição do objetivo, aberto pelo pill do composer,
          pelo card de atenção, pelo `/goal` ou pelo painel central. */}
      {goalDialog ? (
        <GoalDialog
          conversationId={goalDialog.conversationId}
          mode={goalDialog.mode}
          onClose={closeGoalDialog}
        />
      ) : null}
    </div>
  );
}
