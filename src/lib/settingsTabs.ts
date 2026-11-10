/**
 * Settings dialog tabs (DESIGN §9).
 *
 * Single source of truth for the tab ids and translation keys shared by the
 * settings dialog and the command palette ("Settings › Data"). Icons stay in
 * the UI layer (`components/settings`) because they are presentation-only.
 */

export type SettingsTabId =
  | 'general'
  | 'themes'
  | 'providers'
  | 'model'
  | 'instructions'
  | 'tools'
  | 'agents'
  | 'data'
  | 'about';

export interface SettingsTabDefinition {
  id: SettingsTabId;
  labelKey: string;
}

export const SETTINGS_TABS = [
  { id: 'general', labelKey: 'tabs.general' },
  { id: 'themes', labelKey: 'tabs.themes' },
  { id: 'providers', labelKey: 'tabs.providers' },
  { id: 'model', labelKey: 'tabs.model' },
  { id: 'instructions', labelKey: 'tabs.instructions' },
  { id: 'tools', labelKey: 'tabs.tools' },
  { id: 'agents', labelKey: 'tabs.agents' },
  { id: 'data', labelKey: 'tabs.data' },
  { id: 'about', labelKey: 'tabs.about' },
] as const satisfies readonly SettingsTabDefinition[];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'general';

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((tab) => tab.id));

/** Narrows an untrusted value (rehydrated state, URL, test) to a valid tab id. */
export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === 'string' && SETTINGS_TAB_IDS.has(value);
}
