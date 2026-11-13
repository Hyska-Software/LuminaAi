import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Loader2, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button, IconButton, NativeSelect, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import type { AgentMemory, AgentMemoryKind, AgentSharedMemory } from '@/lib/types';
import { cn } from '@/lib/utils';

const KIND_OPTIONS: AgentMemoryKind[] = ['fact', 'preference', 'procedure', 'note'];

type Translate = TFunction<'agents'>;

function kindLabel(kind: AgentMemoryKind, t: Translate): string {
  switch (kind) {
    case 'preference':
      return t('memory.kinds.preference');
    case 'procedure':
      return t('memory.kinds.procedure');
    case 'note':
      return t('memory.kinds.note');
    case 'fact':
    default:
      return t('memory.kinds.fact');
  }
}

/**
 * Durable memory manager for one agent. Memories are shared by every
 * conversation of the persona; the harness injects them as a volatile context
 * block, never into the cached system prompt.
 */
export function AgentMemoryPanel({
  agentId,
  memoryEnabled,
  className,
}: {
  agentId: string | null;
  memoryEnabled: boolean;
  className?: string;
}) {
  const { t } = useTranslation('agents');
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [shared, setShared] = useState<AgentSharedMemory[]>([]);
  const [tab, setTab] = useState<'private' | 'shared'>('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<AgentMemoryKind>('fact');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const load = useCallback(async () => {
    if (!agentId) {
      setMemories([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [privateMemories, sharedMemories] = await Promise.all([
        api.listAgentMemories(agentId),
        api.listSharedAgentMemories(),
      ]);
      setMemories(privateMemories);
      setShared(sharedMemories);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!agentId) {
      toast.info(t('memory.saveAgentFirst'));
      return;
    }
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const memory = await api.createAgentMemory(agentId, { kind: draftKind, content });
      setMemories((current) => [memory, ...current]);
      setDraft('');
      toast.success(t('memory.saved'));
    } catch (caught) {
      toast.error(t('memory.saveError'), { description: String(caught) });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (memory: AgentMemory) => {
    const content = editingText.trim();
    if (!content) return;
    try {
      const updated = await api.updateAgentMemory(memory.agentId, memory.id, {
        kind: memory.kind,
        content,
        pinned: memory.pinned,
      });
      setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(null);
      setEditingText('');
    } catch (caught) {
      toast.error(t('memory.updateError'), { description: String(caught) });
    }
  };

  const togglePinned = async (memory: AgentMemory) => {
    try {
      const updated = await api.updateAgentMemory(memory.agentId, memory.id, {
        kind: memory.kind,
        content: memory.content,
        pinned: !memory.pinned,
      });
      setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      toast.error(t('memory.pinError'), { description: String(caught) });
    }
  };

  const remove = async (memory: AgentMemory) => {
    try {
      await api.deleteAgentMemory(memory.agentId, memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (caught) {
      toast.error(t('memory.deleteError'), { description: String(caught) });
    }
  };

  const clearAll = async () => {
    if (!agentId || memories.length === 0) return;
    // eslint-disable-next-line no-alert -- destructive action needs a native confirmation here
    if (!window.confirm(t('memory.clearConfirm', { count: memories.length }))) return;
    try {
      await api.clearAgentMemories(agentId);
      setMemories([]);
      toast.success(t('memory.cleared'));
    } catch (caught) {
      toast.error(t('memory.clearError'), { description: String(caught) });
    }
  };

  const removeShared = async (memory: AgentSharedMemory) => {
    try {
      await api.deleteSharedAgentMemory(memory.id);
      setShared((current) => current.filter((item) => item.id !== memory.id));
    } catch (caught) {
      toast.error(t('memory.sharedDeleteError'), {
        description: String(caught),
      });
    }
  };

  if (!agentId) {
    return (
      <p className={cn('text-[12px] leading-relaxed text-foreground-muted', className)}>
        {t('memory.saveFirst')}
      </p>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex gap-1 rounded-lg bg-surface p-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'private'}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[11px]',
            tab === 'private' ? 'bg-surface-active text-foreground' : 'text-foreground-muted',
          )}
          onClick={() => setTab('private')}
        >
          {t('memory.tabs.private')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'shared'}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[11px]',
            tab === 'shared' ? 'bg-surface-active text-foreground' : 'text-foreground-muted',
          )}
          onClick={() => setTab('shared')}
        >
          {t('memory.tabs.shared')}
        </button>
      </div>

      {tab === 'shared' ? (
        <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-foreground-muted">
            {t('memory.shared.description')}
          </p>
          {shared.length === 0 ? (
            <p className="rounded-xl bg-surface p-3 text-[12px] text-foreground-muted">
              {t('memory.shared.empty')}
            </p>
          ) : (
            shared.map((memory) => (
              <div
                key={memory.id}
                className="flex items-start gap-2 rounded-xl bg-surface p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-relaxed text-foreground">{memory.content}</p>
                  <p className="mt-1 text-[10px] text-foreground-subtle">
                    {kindLabel(memory.kind, t)}{' '}
                    · {memory.sourceAgentName ?? t('memory.shared.removedAgent')}
                  </p>
                </div>
                <IconButton
                  label={t('memory.shared.deleteAria')}
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeShared(memory)}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] leading-relaxed text-foreground-muted">
          {memoryEnabled
            ? t('memory.private.enabledNote')
            : t('memory.private.disabledNote')}
        </p>
        {memories.length > 0 ? (
          <Button size="sm" variant="ghost" className="shrink-0 text-danger" onClick={() => void clearAll()}>
            {t('memory.clear')}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2 rounded-xl bg-surface p-3">
        <div className="flex items-center gap-2">
          <NativeSelect
            value={draftKind}
            aria-label={t('memory.kindAria')}
            className="h-8 w-36 text-[12px]"
            onChange={(event) => setDraftKind(event.target.value as AgentMemoryKind)}
          >
            {KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(kind, t)}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            className="ml-auto"
            disabled={saving || !draft.trim()}
            onClick={() => void add()}
          >
            {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plus className="mr-1.5 size-3.5" />}
            {t('memory.add')}
          </Button>
        </div>
        <Textarea
          value={draft}
          rows={2}
          maxLength={4096}
          placeholder={t('memory.placeholder')}
          aria-label={t('memory.newAria')}
          className="min-h-16 resize-y text-[12px]"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void add();
          }}
        />
      </div>

      {loading ? (
        <p className="text-[12px] text-foreground-muted">{t('memory.loading')}</p>
      ) : error ? (
        <div className="text-[12px] text-foreground-muted">
          {t('memory.loadError')}
          <Button size="sm" variant="ghost" className="ml-2 px-0" onClick={() => void load()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : memories.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-foreground-subtle">
          {t('memory.empty')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="rounded-xl bg-surface p-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                  {kindLabel(memory.kind, t)}
                </span>
                <div className="min-w-0 flex-1">
                  {editingId === memory.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editingText}
                        rows={2}
                        maxLength={4096}
                        className="min-h-16 resize-y text-[12px]"
                        onChange={(event) => setEditingText(event.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          {t('common:actions.cancel')}
                        </Button>
                        <Button size="sm" onClick={() => void saveEdit(memory)}>
                          {t('common:actions.save')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(memory.id);
                        setEditingText(memory.content);
                      }}
                      className="block w-full whitespace-pre-wrap text-left text-[12px] leading-relaxed text-foreground hover:text-accent"
                    >
                      {memory.content}
                    </button>
                  )}
                </div>
                <IconButton
                  label={memory.pinned ? t('memory.unpinAria') : t('memory.pinAria')}
                  size="sm"
                  variant="ghost"
                  onClick={() => void togglePinned(memory)}
                >
                  {memory.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </IconButton>
                <IconButton
                  label={t('memory.deleteAria')}
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(memory)}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!memoryEnabled && memories.length > 0 ? (
        <p className="rounded-lg bg-surface-hover px-3 py-2 text-[11px] text-foreground-muted">
          {t('memory.disabledFootnote')}
        </p>
      ) : null}
        </>
      )}
    </div>
  );
}
