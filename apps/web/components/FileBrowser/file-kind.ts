/**
 * File-kind detection by extension — shared by the preview pane and the grid view
 * so both agree on what previews inline vs. only downloads.
 */
export type FileKind = 'markdown' | 'text' | 'pdf' | 'image' | 'other';

const IMAGE_EXT: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** Classify a storage key / filename by its extension. */
export function fileKind(keyOrName: string): FileKind {
  const ext = keyOrName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'txt' || ext === 'text') return 'text';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'other';
}
