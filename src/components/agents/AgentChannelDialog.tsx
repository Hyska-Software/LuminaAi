import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Loader2, Users } from 'lucide-react';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
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
  const { t } = useTranslation('agents');
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leaderAgentId, setLeaderAgentId] = useState<string | null>(null);
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(channel?.name ?? '');
    setMemberIds(channel?.memberIds ?? []);
    setLeaderAgentId(channel?.leaderAgentId ?? null);
    setLeaderOpen(false);
    setError(null);
  }, [open, channel]);

  const memberAgents = agents.filter((agent) => memberIds.includes(agent.id));
  const selectedLeader = leaderAgentId
    ? (memberAgents.find((agent) => agent.id === leaderAgentId) ?? null)
    : null;

  const selectLeader = (agentId: string | null) => {
    setLeaderAgentId(agentId);
    setLeaderOpen(false);
  };

  const handleLeaderListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    if (options.length === 0) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % options.length;
    else next = current <= 0 ? options.length - 1 : current - 1;
    options[next]?.focus();
  };

  const toggle = (agentId: string) => {
    if (memberIds.includes(agentId)) {
      setLeaderAgentId((current) => (current === agentId ? null : current));
    }
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
      setError(t('channelDialog.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        memberIds,
        leaderAgentId: selectedLeader?.id ?? null,
      };
      const saved = channel
        ? await api.updateAgentChannel(channel.id, input)
        : await api.createAgentChannel(input);
      onSaved(saved);
      toast.success(channel ? t('channelDialog.updated') : t('channelDialog.created'), {
        description: saved.name,
      });
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
    if (!window.confirm(t('channelDialog.deleteConfirm', { name: channel.name }))) {
      return;
    }
    try {
      await api.deleteAgentChannel(channel.id);
      onDeleted?.(channel.id);
      onOpenChange(false);
      toast.success(t('channelDialog.deleted'));
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
            {channel ? t('channelDialog.editTitle') : t('channelDialog.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('channelDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="channel-name">{t('channelDialog.name')}</Label>
            <Input
              id="channel-name"
              value={name}
              maxLength={60}
              placeholder={t('channelDialog.namePlaceholder')}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('channelDialog.members')}</Label>
            {agents.length === 0 ? (
              <p className="text-[12px] text-foreground-muted">
                {t('channelDialog.noAgents')}
              </p>
            ) : (
              <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {agents.map((agent) => {
                  const selected = memberIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(agent.id)}
                      className={cn(
                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px]',
                        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        selected
                          ? 'border-accent/40 bg-accent-soft/50 text-foreground'
                          : 'border-border bg-surface-raised/40 text-foreground-muted hover:border-border-strong hover:bg-surface-hover hover:text-foreground',
                      )}
                    >
                      <AgentAvatar avatar={agent.avatar} size="sm" />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-foreground-subtle">
              {t('channelDialog.membersHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="channel-leader">{t('channelDialog.leader')}</Label>
            <Popover open={leaderOpen} onOpenChange={setLeaderOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  id="channel-leader"
                  disabled={saving || memberAgents.length === 0}
                  aria-label={t('channelDialog.leaderAria', {
                    name: selectedLeader?.name ?? t('channelDialog.noLeader'),
                  })}
                  aria-haspopup="listbox"
                  className={cn(
                    'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 text-left text-sm text-foreground',
                    'transition-[border-color,box-shadow,background-color] duration-150 hover:bg-surface-hover',
                    'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  {selectedLeader ? (
                    <AgentAvatar avatar={selectedLeader.avatar} size="sm" />
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-active/70 text-foreground-subtle">
                      <Users aria-hidden className="size-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {selectedLeader?.name ?? t('channelDialog.noLeader')}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className="size-4 shrink-0 text-foreground-subtle"
                    strokeWidth={2}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={6}
                collisionPadding={12}
                className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-1"
              >
                <div
                  role="listbox"
                  aria-label={t('channelDialog.leaderListAria')}
                  className="grid max-h-64 gap-0.5 overflow-y-auto"
                  onKeyDown={handleLeaderListKeyDown}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedLeader === null}
                    autoFocus={selectedLeader === null}
                    onClick={() => selectLeader(null)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      selectedLeader === null
                        ? 'bg-accent-soft text-foreground'
                        : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                    )}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-active/70 text-foreground-subtle">
                      <Users aria-hidden className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t('channelDialog.noLeader')}</span>
                    {selectedLeader === null ? (
                      <Check aria-hidden className="size-4 shrink-0 text-accent" />
                    ) : null}
                  </button>
                  {memberAgents.map((agent) => {
                    const active = agent.id === leaderAgentId;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        autoFocus={active}
                        onClick={() => selectLeader(agent.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                          active
                            ? 'bg-accent-soft text-foreground'
                            : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                        )}
                      >
                        <AgentAvatar avatar={agent.avatar} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                        {active ? (
                          <Check aria-hidden className="size-4 shrink-0 text-accent" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-foreground-subtle">
              {t('channelDialog.leaderHint')}
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
              {t('channelDialog.delete')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim() || agents.length === 0 || memberIds.length === 0}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {channel ? t('channelDialog.save') : t('channelDialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
