import { useEffect, useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, BookOpen, Eye, FolderOpen, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { SkillSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore, useUiStore } from '@/lib/store';
import { Badge, Button, IconButton, Spinner, Switch } from '@/components/ui';
import { groupSkillsBySource, localizedSkillMeta, type SkillSourceMeta } from './sources';
import { SkillPreviewDialog } from './SkillPreviewDialog';

type SkillsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; skills: SkillSummary[] };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface GroupProps {
  meta: SkillSourceMeta;
  headingId: string;
  skills: SkillSummary[];
  busySkill: string | null;
  confirming: string | null;
  onToggle: (skill: SkillSummary, enabled: boolean) => void;
  onPreview: (skill: SkillSummary) => void;
  onRequestDelete: (skill: SkillSummary) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (skill: SkillSummary) => void;
}

function SkillGroup({
  meta,
  headingId,
  skills,
  busySkill,
  confirming,
  onToggle,
  onPreview,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: GroupProps) {
  const { t } = useTranslation('library');
  if (!skills.length) return null;
  const GroupIcon = meta.icon;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <GroupIcon aria-hidden className="size-4 text-foreground-subtle" />
          <h2 id={headingId} className="text-[13px] font-semibold tracking-tight text-foreground">
            {meta.groupLabel}
          </h2>
          <Badge tone="muted">{skills.length}</Badge>
          {meta.external ? (
            <Badge tone="outline">
              <Lock aria-hidden className="size-2.5" />
              {t('library:skills.view.readOnly')}
            </Badge>
          ) : null}
        </div>
        {meta.external ? (
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            {t('library:skills.view.externalDescription')}
          </p>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-raised px-3">
        {skills.map((skill) => {
          const busy = busySkill === skill.name;
          const askingDelete = confirming === skill.name;
          const display = localizedSkillMeta(skill);
          return (
            <li
              key={`${skill.source}-${skill.name}`}
              aria-busy={busy || undefined}
              className="flex flex-wrap items-start gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      'font-mono text-[12px] font-medium',
                      skill.enabled ? 'text-foreground' : 'text-foreground-muted',
                    )}
                  >
                    {display.name}
                  </span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {!skill.enabled ? (
                    <Badge tone="muted">{t('library:skills.view.disabledBadge')}</Badge>
                  ) : null}
                </div>
                <p
                  className={cn(
                    'mt-0.5 text-[11px] leading-relaxed',
                    skill.enabled ? 'text-foreground-muted' : 'text-foreground-subtle',
                  )}
                >
                  {display.description}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {askingDelete ? (
                  <div
                    role="group"
                    aria-label={t('library:skills.view.deleteConfirmAria', {
                      name: skill.name,
                    })}
                    className="flex items-center gap-1.5"
                  >
                    <span className="text-[11px] font-medium text-danger">
                      {t('library:skills.view.deleteQuestion')}
                    </span>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={onCancelDelete}>
                      {t('common:actions.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy}
                      onClick={() => onConfirmDelete(skill)}
                    >
                      {t('common:actions.delete')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Switch
                      checked={skill.enabled}
                      disabled={busy}
                      onCheckedChange={(checked) => onToggle(skill, checked)}
                      aria-label={t('library:skills.view.enableAria', { name: skill.name })}
                    />
                    <IconButton
                      label={t('library:skills.view.previewAria', { name: skill.name })}
                      size="sm"
                      disabled={busy}
                      onClick={() => onPreview(skill)}
                    >
                      <Eye className="size-4" />
                    </IconButton>
                    {skill.deletable ? (
                      <IconButton
                        label={t('library:skills.view.deleteAria', { name: skill.name })}
                        size="sm"
                        disabled={busy}
                        className="hover:text-danger"
                        onClick={() => onRequestDelete(skill)}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface SkillsViewProps {
  /**
   * Overrides the default "back to chat" navigation. The Code layout opens the
   * same page in its center column and returns to the agent session instead
   * (docs/goals/chat-code-layout/PLAN.md §3.2).
   */
  onBack?: () => void;
  /** Label of the back action (defaults to the Chat copy). */
  backLabel?: string;
}

/**
 * Skills manager rendered as the main view in place of the chat column
 * (FILES §7.4): list grouped by origin, per-skill enable switch, inline
 * deletion for user skills. The chat stays mounted behind it, so "Voltar ao
 * chat" restores the conversation untouched.
 */
export function SkillsView({ onBack, backLabel }: SkillsViewProps = {}) {
  const { t } = useTranslation('library');
  const reloadSettings = useAppStore((state) => state.reloadSettings);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const handleBack = onBack ?? (() => setActiveView('chat'));

  const [state, setState] = useState<SkillsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busySkill, setBusySkill] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<SkillSummary | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);
  const rawId = useId();
  const idPrefix = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const viewRef = useRef<HTMLElement | null>(null);

  // The view replaces the chat: move focus into it so keyboard users do not
  // stay on a control that was just unmounted.
  useEffect(() => {
    viewRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getSkills()
      .then((skills) => {
        if (!cancelled) setState({ status: 'ready', skills });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const applySkills = (skills: SkillSummary[]) => setState({ status: 'ready', skills });

  const toggleSkill = async (skill: SkillSummary, enabled: boolean) => {
    setBusySkill(skill.name);
    try {
      const skills = await api.setSkillEnabled(skill.name, enabled);
      // The command persists `disabled_skills` on the backend; refresh the store
      // so a later saveSettings cannot overwrite it with the stale list.
      await reloadSettings();
      applySkills(skills);
    } catch (error) {
      toast.error(t('library:skills.view.updateError'), { description: describeError(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const deleteSkill = async (skill: SkillSummary) => {
    setBusySkill(skill.name);
    try {
      const skills = await api.deleteSkill(skill.name);
      await reloadSettings();
      applySkills(skills);
      setConfirming(null);
      toast.success(t('library:skills.view.deleted'), { description: skill.name });
    } catch (error) {
      toast.error(t('library:skills.view.deleteError'), { description: describeError(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const openSkillsFolder = async () => {
    setOpeningFolder(true);
    try {
      await api.openSkillsDir();
    } catch (error) {
      toast.error(t('library:skills.view.openFolderError'), { description: describeError(error) });
    } finally {
      setOpeningFolder(false);
    }
  };

  const skills = state.status === 'ready' ? state.skills : [];
  const groups = groupSkillsBySource(skills);
  const hasDisabled = skills.some((skill) => !skill.enabled);

  return (
    <section
      ref={viewRef}
      tabIndex={-1}
      aria-label={t('library:skills.view.aria')}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pb-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={() => handleBack()}
            >
              {backLabel ?? t('library:skills.view.back')}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={openingFolder}
                leftIcon={<FolderOpen className="size-3.5" />}
                onClick={() => void openSkillsFolder()}
              >
                {t('library:skills.view.openFolder')}
              </Button>
            </div>
          </div>
          <div>
            <h1 className="text-[19px] font-semibold leading-6 tracking-tight text-foreground">
              {t('library:skills.view.title')}
            </h1>
            <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
              {t('library:skills.view.description')}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {state.status === 'loading' ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2">
              <Spinner
                size="md"
                className="text-accent"
                label={t('library:skills.view.loadingLabel')}
              />
              <span className="text-xs text-foreground-muted">{t('library:skills.view.loading')}</span>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertTriangle aria-hidden className="size-5 text-danger" />
              <p className="text-[13px] font-medium text-foreground">
                {t('library:skills.view.loadErrorTitle')}
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                {state.message}
              </p>
              <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
                {t('library:skills.view.retry')}
              </Button>
            </div>
          ) : null}

          {state.status === 'ready' && !skills.length ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
              <BookOpen aria-hidden className="size-5 text-foreground-subtle" />
              <p className="text-[13px] font-medium text-foreground">
                {t('library:skills.view.emptyTitle')}
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                <Trans
                  ns="library"
                  i18nKey="skills.view.emptyDescription"
                  values={{ file: 'SKILL.md' }}
                  components={{ code: <code className="font-mono" /> }}
                />
              </p>
            </div>
          ) : null}

          {state.status === 'ready' && skills.length ? (
            <div className="flex flex-col gap-5">
              {hasDisabled ? (
                <p
                  role="note"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-foreground-muted"
                >
                  {t('library:skills.view.disabledNote')}
                </p>
              ) : null}

              {groups.map((group, index) => (
                <SkillGroup
                  key={group.source}
                  meta={group.meta}
                  headingId={`${idPrefix}-group-${index}`}
                  skills={group.skills}
                  busySkill={busySkill}
                  confirming={confirming}
                  onToggle={(skill, enabled) => void toggleSkill(skill, enabled)}
                  onPreview={setPreviewSkill}
                  onRequestDelete={(skill) => setConfirming(skill.name)}
                  onCancelDelete={() => setConfirming(null)}
                  onConfirmDelete={(skill) => void deleteSkill(skill)}
                />
              ))}

              <p className="mt-1 flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-foreground-muted">
                <BookOpen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle" />
                <span>
                  <Trans
                    ns="library"
                    i18nKey="skills.view.createNote"
                    values={{ path: 'skills/<nome>/SKILL.md' }}
                    components={{ code: <code className="font-mono text-foreground" /> }}
                  />
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {previewSkill ? (
        <SkillPreviewDialog skill={previewSkill} onClose={() => setPreviewSkill(null)} />
      ) : null}
    </section>
  );
}

export default SkillsView;
