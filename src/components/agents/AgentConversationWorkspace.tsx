import { useState } from 'react';
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
    catch (cause) { setError(`Não foi possível carregar as pastas: ${String(cause)}`); }
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
      setError(`Não foi possível alterar a pasta: ${String(cause)}`);
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button type="button" size="sm" variant="ghost" aria-label="Pasta da conversa" disabled={busy} onClick={() => void show()}>
        <FolderOpen className="mr-1.5 size-4" aria-hidden /> Pasta
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Pasta da conversa</DialogTitle>
            <DialogDescription>
              Escolha uma pasta para esta conversa ou use a pasta interna. Trocar de pasta não move nem apaga arquivos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-6">
            <Label htmlFor="agent-conversation-workspace">Pasta desta conversa</Label>
            <NativeSelect id="agent-conversation-workspace" value={selected} disabled={loading || saving || busy} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Pasta interna do aplicativo</option>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id} disabled={!workspace.trusted}>{workspace.name}{workspace.trusted ? '' : ' (não confiável)'}</option>)}
            </NativeSelect>
            <AgentWorkspacePicker onSelected={(workspace) => {
              setWorkspaces((current) => [...current.filter((item) => item.id !== workspace.id), workspace]);
              setSelected(workspace.id);
            }} />
            {error ? <p role="alert" className="text-[11px] text-danger">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="button" size="sm" disabled={saving || loading || busy} onClick={() => void save()}>Salvar pasta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
