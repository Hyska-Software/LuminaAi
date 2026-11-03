import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { AgentAvatar } from './AgentAvatar';
import { AgentDialogBody } from './AgentDialogBody';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@/components/ui';
import { api } from '@/lib/api';
import { selectActiveAgents, useAgentStore } from '@/lib/store';
import type { AgentChannel } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AgentChannelDialog({
  channel,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  channel: AgentChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (channel: AgentChannel) => void;
  onDeleted?: (channelId: string) => void;
}) {
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(channel?.name ?? '');
    setMemberIds(channel?.memberIds ?? []);
    setError(null);
  }, [open, channel]);

  const toggle = (agentId: string) => {
    setMemberIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : current.length >= 6
          ? current
          : [...current, agentId],
    );
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Dê um nome ao canal.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = { name: name.trim(), memberIds };
      const saved = channel
        ? await api.updateAgentChannel(channel.id, input)
        : await api.createAgentChannel(input);
      onSaved(saved);
      toast.success(channel ? 'Canal atualizado' : 'Canal criado', { description: saved.name });
      onOpenChange(false);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!channel) return;
    // eslint-disable-next-line no-alert -- destructive action needs a native confirmation here
    if (!window.confirm(`Excluir o canal “${channel.name}”? O histórico compartilhado e as threads derivadas serão removidos.`)) {
      return;
    }
    try {
      await api.deleteAgentChannel(channel.id);
      onDeleted?.(channel.id);
      onOpenChange(false);
      toast.success('Canal excluído');
    } catch (caught) {
      setError(String(caught));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-accent" />
            {channel ? 'Editar canal' : 'Novo canal'}
          </DialogTitle>
          <DialogDescription>
            Um canal é uma thread compartilhada: todos os agentes marcados leem e escrevem nela.
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="channel-name">Nome</Label>
            <Input
              id="channel-name"
              value={name}
              maxLength={60}
              placeholder="Ex.: Lançamento"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Participantes</Label>
            {agents.length === 0 ? (
              <p className="text-[12px] text-foreground-muted">
                Crie pelo menos um agente antes de montar um canal.
              </p>
            ) : (
              <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {agents.map((agent) => {
                  const selected = memberIds.includes(agent.id);
                  return (
                    <label
                      key={agent.id}
                      className={cn(
                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-[12px]',
                        selected ? 'border-accent/40 bg-accent-soft/50' : 'bg-surface-raised/40',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggle(agent.id)}
                        className="size-3.5 accent-accent"
                      />
                      <AgentAvatar emoji={agent.emoji} size="sm" />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-foreground-subtle">
              Até 6 agentes. Cada resposta é gerada na thread privada do agente e publicada no canal.
            </p>
          </div>
          {error ? (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          ) : null}
        </AgentDialogBody>
        <DialogFooter>
          {channel ? (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => void remove()} disabled={saving}>
              Excluir canal
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim() || agents.length === 0 || memberIds.length === 0}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {channel ? 'Salvar canal' : 'Criar canal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
