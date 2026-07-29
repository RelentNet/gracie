/**
 * File-kind detection by extension — shared by the preview pane and the grid view
 * so both agree on what previews inline vs. only downloads.
 */
export type FileKind =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'image'
  | 'csv'
  | 'docx'
  | 'xlsx'
  | 'other';

// SVGs render through the <img> path, not inline markup — browsers don't execute
// scripts in an image-loaded SVG, so this stays XSS-safe.
const IMAGE_EXT: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

/** Classify a storage key / filename by its extension. */
export function fileKind(keyOrName: string): FileKind {
  const ext = keyOrName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'txt' || ext === 'text') return 'text';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'other';
}
