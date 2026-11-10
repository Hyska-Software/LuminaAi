import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/lib/i18n';

/** Native picker filters: images and the documents `documents::extract` handles. */
export function attachmentFilters(): { name: string; extensions: string[] }[] {
  return [
    {
      name: t('composer:attachments.filters.documents'),
      extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'json', 'csv'],
    },
    { name: t('composer:attachments.filters.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    { name: t('composer:attachments.filters.all'), extensions: ['*'] },
  ];
}

/** Opens the native attachment picker and returns the selected paths. */
export async function pickAttachmentPaths(): Promise<string[]> {
  const selection = await open({
    multiple: true,
    title: t('composer:attachments.pickerTitle'),
    filters: attachmentFilters(),
  });
  if (Array.isArray(selection)) return selection;
  return selection ? [selection] : [];
}

/** True when the clipboard carries files (OS file copy, screenshot, image copy). */
export function clipboardHasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  if (data.files && data.files.length > 0) return true;
  return Array.from(data.types ?? []).includes('Files');
}

export function clipboardText(data: DataTransfer | null): string {
  try {
    return data?.getData('text') ?? '';
  } catch {
    return '';
  }
}
