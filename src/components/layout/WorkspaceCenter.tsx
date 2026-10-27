import { ChatView } from '@/components/chat/ChatView';
import { CodeSessionHeader, CodeWelcomeScreen, CodeDiffView } from '@/components/code';
import { LibraryView } from '@/components/library';
import { SkillsView } from '@/components/skills';
import { useUiStore } from '@/lib/store';
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
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const setCodeView = useUiStore((state) => state.setCodeView);

  const isCode = layoutMode === 'code';
  const showSkills = isCode ? codeView === 'skills' : activeView === 'skills';
  const showLibrary = !isCode && activeView === 'library';
  const showDiff = isCode && codeView === 'diff' && codeDiffTab !== null;
  const showChat = !showSkills && !showLibrary && !showDiff;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Stable wrapper: the conversation below keeps its DOM position across
          layout switches (see `aria-controls` of the Code session tabs). The
          header stays mounted while the Code Skills page is open so the open
          session tabs are not lost when coming back (PLAN §3.3). */}
      <div
        className={cn('shrink-0', !(isCode && (showChat || showDiff)) && 'hidden')}
        aria-hidden={isCode && !(showChat || showDiff) ? true : undefined}
        inert={isCode && !(showChat || showDiff) ? true : undefined}
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

      {showSkills ? (
        <SkillsView
          onBack={() => (isCode ? setCodeView('session') : setActiveView('chat'))}
          backLabel={isCode ? 'Voltar à sessão' : 'Voltar ao chat'}
        />
      ) : null}

      {showLibrary ? <LibraryView /> : null}
    </div>
  );
}
