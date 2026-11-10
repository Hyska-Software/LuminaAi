import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/lib/store';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';

/**
 * One-time first-run choice: keep working in the background when the window
 * closes, or quit. The answer is persisted in settings and can be changed
 * later in Settings → General.
 */
export function TrayPromptDialog() {
  const { t } = useTranslation('settings');
  const ready = useAppStore((state) => state.ready);
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  // `undefined` (older backend payload) must not re-ask forever; only an
  // explicit false means the prompt is still pending.
  const open = ready && settings.closeToTrayPrompted === false;

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        size="sm"
        showClose={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('trayPrompt.title')}</DialogTitle>
          <DialogDescription>{t('trayPrompt.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() =>
              void saveSettings({ closeToTray: false, closeToTrayPrompted: true })
            }
          >
            {t('trayPrompt.disable')}
          </Button>
          <Button
            variant="primary"
            autoFocus
            onClick={() =>
              void saveSettings({ closeToTray: true, closeToTrayPrompted: true })
            }
          >
            {t('trayPrompt.enable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
