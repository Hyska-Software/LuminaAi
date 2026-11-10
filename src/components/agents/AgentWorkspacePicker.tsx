import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { api } from '@/lib/api';
import type { Workspace } from '@/lib/types';

export function AgentWorkspacePicker({ onSelected }: { onSelected: (workspace: Workspace) => void }) {
  const { t } = useTranslation('agents');
  const [pending, setPending] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFolder = async () => {
    setError(null);
    setBusy(true);
    try {
      const path = await api.pickWorkspaceFolder();
      if (!path) return;
      const workspace = await api.addWorkspace(path, false);
      if (workspace.trusted) onSelected(workspace);
      else setPending(workspace);
    } catch (cause) {
      setError(t('workspacePicker.openError', { cause: String(cause) }));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      const workspace = await api.setWorkspaceTrusted(pending.id, true);
      onSelected(workspace);
      setPending(null);
    } catch (cause) {
      setError(t('workspacePicker.trustError', { cause: String(cause) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void chooseFolder()}>
        <FolderOpen className="mr-1.5 size-4" aria-hidden />
        {t('workspacePicker.choose')}
      </Button>
      {!pending && error ? <p role="alert" className="text-[11px] text-danger">{error}</p> : null}
      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open && !busy) setPending(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('workspacePicker.trustTitle')}</DialogTitle>
            <DialogDescription>
              {t('workspacePicker.trustDescription')}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all px-6 text-[12px] text-foreground-muted">{pending?.path}</p>
          {error ? <p role="alert" className="px-6 text-[11px] text-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setPending(null)}>{t('common:actions.cancel')}</Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void confirm()}>{t('workspacePicker.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
