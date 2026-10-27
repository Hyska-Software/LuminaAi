/**
 * Code workbench (docs/goals/chat-code-layout/PLAN.md): the Chat | Code toggle
 * lives in the title bar; these are the surfaces that only exist in the Code
 * layout. The harness integration (workspace, files, git) comes in the next
 * phase — everything that depends on it is an honest empty state.
 */
export { CodeSidebar } from './CodeSidebar';
export type { CodeSidebarProps } from './CodeSidebar';

export { AddChatSessionDialog } from './AddChatSessionDialog';
export type { AddChatSessionDialogProps } from './AddChatSessionDialog';

export { CodeSessionHeader } from './CodeSessionHeader';

export { CodePanel } from './CodePanel';

export { CodeWelcomeScreen } from './CodeWelcomeScreen';
