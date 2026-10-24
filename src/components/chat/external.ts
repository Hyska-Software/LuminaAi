/** Only http(s) links are handed to the OS browser (ARCHITECTURE §13). */
export function isExternalUrl(url?: string | null): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/**
 * Opens a link in the user's default browser through the opener plugin,
 * falling back to `window.open` when running outside Tauri.
 *
 * The plugin is imported lazily so it does not weigh on the initial bundle.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const target = url?.trim();
  if (!isExternalUrl(target)) return false;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(target);
    return true;
  } catch {
    /* fall back to the browser below */
  }
  try {
    window.open(target, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
