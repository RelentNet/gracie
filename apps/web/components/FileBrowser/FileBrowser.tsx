'use client';

import { DriveBrowser } from '@/components/FileBrowser/DriveBrowser';

/**
 * FileBrowser (docs/08 §8 M11) — the client-scoped two-panel folder tree + file
 * list (client tab 6). A thin wrapper over {@link DriveBrowser} in `client` scope;
 * the global Documents page uses `DriveBrowser` in `global` scope directly.
 *
 * ROLE RULES (docs/08 §1/§7, D14): restricted folders (e.g. Transcripts) are
 * OMITTED entirely for non-admins — enforced SERVER-SIDE by the folders/documents
 * APIs and mirrored client-side as defense-in-depth. Editors get working Upload /
 * New Folder / Move; viewers get a read-only browser with Download only.
 */
export interface FileBrowserProps {
  readonly clientId: string;
}

export function FileBrowser({ clientId }: FileBrowserProps): React.JSX.Element {
  return <DriveBrowser scope={{ kind: 'client', clientId }} />;
}
