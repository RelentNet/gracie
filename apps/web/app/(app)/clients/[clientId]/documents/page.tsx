'use client';

import { use } from 'react';

import { FileBrowser } from '@/components/FileBrowser/FileBrowser';

/**
 * Client tab 6 — Documents (docs/08 §9). Renders the two-panel file browser
 * (Module 11) scoped to this client. The Transcripts folder has `restricted`
 * visibility and is OMITTED entirely for non-admins (handled inside the browser,
 * D14). {@link FileBrowser} fetches the real folders/documents APIs for this
 * client id and owns its own loading/empty/error states — no client lookup here
 * (the old `@/lib/mock` guard was a Phase-1 leftover that 404'd every real org).
 */
export default function ClientDocumentsPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  return <FileBrowser clientId={clientId} />;
}
