import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import { api } from '@/lib/api';
import type { ComputerActionRecord } from '@/lib/types';

/** Rótulo de uma ação de computer/browser; cai para a tool bruta. */
function labelFor(
  action: string,
  tool: string,
  t: (key: string) => string,
): string {
  switch (action || tool) {
    case 'computer.control_taken':
      return t('computerActivity.actions.controlTaken');
    case 'computer.control_released':
      return t('computerActivity.actions.controlReleased');
    case 'computer_screenshot':
      return t('computerActivity.actions.screenshot');
    case 'computer_click':
      return t('computerActivity.actions.click');
    case 'computer_type':
      return t('computerActivity.actions.type');
    case 'computer_key':
      return t('computerActivity.actions.key');
    case 'computer_drag':
      return t('computerActivity.actions.drag');
    case 'computer_scroll':
      return t('computerActivity.actions.scroll');
    case 'computer_move':
      return t('computerActivity.actions.move');
    case 'browser_open':
      return t('computerActivity.actions.browserOpen');
    case 'browser_navigate':
      return t('computerActivity.actions.browserNavigate');
    case 'browser_snapshot':
      return t('computerActivity.actions.browserSnapshot');
    case 'browser_click':
      return t('computerActivity.actions.browserClick');
    case 'browser_type':
      return t('computerActivity.actions.browserType');
    case 'browser_download':
      return t('computerActivity.actions.browserDownload');
    default:
      return action || tool;
  }
}

function resultLabel(result: string, t: (key: string) => string): string {
  switch (result) {
    case 'pending':
      return t('computerActivity.result.pending');
    case 'ok':
      return t('computerActivity.result.ok');
    case 'interrupted':
      return t('computerActivity.result.interrupted');
    default:
      return t('computerActivity.result.other');
  }
}

export function ComputerActivity({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('agents');
  const [actions, setActions] = useState<ComputerActionRecord[]>([]);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const next = await api.listComputerActions(conversationId, 4);
        if (!disposed) setActions(next);
      } catch {
        if (!disposed) setActions([]);
      }
    };
    setActions([]);
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [conversationId]);

  return <section aria-label={t('computerActivity.aria')} className="space-y-2 border-t border-border pt-3">
    <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-foreground"><Activity className="size-3.5" /> {t('computerActivity.title')}</h3>
    {actions.length === 0 ? <p className="text-[11px] text-foreground-muted">{t('computerActivity.empty')}</p> :
      <ul className="space-y-2">{actions.map((action) => <li key={action.id} className="flex gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-foreground">{labelFor(action.action, action.tool, t)}</span>
        <span className="shrink-0 text-foreground-muted">{resultLabel(action.result, t)}</span>
      </li>)}</ul>}
  </section>;
}
