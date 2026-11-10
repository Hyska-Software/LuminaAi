import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { AgentWorkspacePicker } from './AgentWorkspacePicker';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, NativeSelect } from '@/components/ui';
import { api } from '@/lib/api';
import type { Conversation, Workspace } from '@/lib/types';

export function AgentConversationWorkspace({ conversation, busy, onChanged }: {
  conversation: Conversation;
  busy: boolean;
  onChanged: (conversation: Conversation) => void;
}) {
  const { t } = useTranslation('agents');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const show = async () => {
    setSelected(conversation.workspaceId ?? '');
    setError(null);
    setOpen(true);
    setLoading(true);
    try { setWorkspaces(await api.listWorkspaces()); }
    catch (cause) { setError(t('conversationWorkspace.loadError', { cause: String(cause) })); }
    finally { setLoading(false); }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setConversationWorkspace(conversation.id, selected || null);
      onChanged(updated);
      setOpen(false);
    } catch (cause) {
      setError(t('conversationWorkspace.changeError', { cause: String(cause) }));
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button type="button" size="sm" variant="ghost" aria-label={t('conversationWorkspace.aria')} disabled={busy} onClick={() => void show()}>
        <FolderOpen className="mr-1.5 size-4" aria-hidden /> {t('conversationWorkspace.button')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('conversationWorkspace.title')}</DialogTitle>
            <DialogDescription>
              {t('conversationWorkspace.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-6">
            <Label htmlFor="agent-conversation-workspace">{t('conversationWorkspace.fieldLabel')}</Label>
            <NativeSelect id="agent-conversation-workspace" value={selected} disabled={loading || saving || busy} onChange={(event) => setSelected(event.target.value)}>
              <option value="">{t('conversationWorkspace.internalFolder')}</option>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id} disabled={!workspace.trusted}>{workspace.trusted ? workspace.name : t('conversationWorkspace.untrusted', { name: workspace.name })}</option>)}
            </NativeSelect>
            <AgentWorkspacePicker onSelected={(workspace) => {
              setWorkspaces((current) => [...current.filter((item) => item.id !== workspace.id), workspace]);
              setSelected(workspace.id);
            }} />
            {error ? <p role="alert" className="text-[11px] text-danger">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button type="button" size="sm" disabled={saving || loading || busy} onClick={() => void save()}>{t('conversationWorkspace.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
