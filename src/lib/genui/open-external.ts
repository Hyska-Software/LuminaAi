/**
 * Opens external links in the user's default browser (never inside the webview).
 * Falls back to `window.open` when the Tauri opener plugin is unavailable.
 */

const SAFE_PROTOCOL = /^https?:\/\//i;

export function isExternalUrl(url: string): boolean {
  return SAFE_PROTOCOL.test(url.trim());
}

export async function openExternal(url: string): Promise<boolean> {
  const target = url.trim();
  if (!isExternalUrl(target)) return false;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(target);
    return true;
  } catch {
    try {
      window.open(target, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }
}
