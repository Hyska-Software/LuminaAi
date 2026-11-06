/**
 * Icons for the settings tabs. Presentation-only mapping kept next to the
 * settings components so both `SettingsDialog` and the command palette use the
 * same icon per tab (ids/labels live in `lib/settingsTabs`).
 */
import {
  Bot,
  Database,
  Info,
  KeyRound,
  ScrollText,
  Settings2,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsTabId } from '@/lib/settingsTabs';

export const SETTINGS_TAB_ICONS: Record<SettingsTabId, LucideIcon> = {
  general: Settings2,
  providers: KeyRound,
  model: Sparkles,
  instructions: ScrollText,
  tools: Wrench,
  agents: Bot,
  data: Database,
  about: Info,
};
