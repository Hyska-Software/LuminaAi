/** Only http(s) links are handed to the OS browser (ARCHITECTURE §13). */
export function isExternalUrl(url?: string | null): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/** `mailto:` links also leave the app (default mail client) via the same opener. */
export function isMailtoUrl(url?: string | null): url is string {
  return typeof url === 'string' && /^mailto:/i.test(url.trim());
}

/**
 * Opens a link in the user's default browser (or mail client for `mailto:`)
 * through the opener plugin, falling back to `window.open` when running
 * outside Tauri.
 *
 * The plugin is imported lazily so it does not weigh on the initial bundle.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const target = url?.trim();
  if (!isExternalUrl(target) && !isMailtoUrl(target)) return false;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(target);
    return true;
  } catch {
    /* fall back to the browser below */
  }
  try {
    if (isMailtoUrl(target)) {
      window.location.href = target;
      return true;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
