'use client';

import { use } from 'react';

import { getClientById } from '@/lib/mock';
import { FileBrowser } from '@/components/FileBrowser/FileBrowser';
import { ErrorState } from '@/components/ui/StateViews';

/**
 * Client tab 6 — Documents (docs/08 §9). Renders the two-panel file browser
 * (Module 11) scoped to this client. The Transcripts folder has `restricted`
 * visibility and is OMITTED entirely for non-admins (handled inside the browser,
 * D14). Data via MOCK selectors; Phase 1B swaps to the files API.
 */
export default function ClientDocumentsPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const client = getClientById(clientId);

  if (client === undefined) {
    return <ErrorState title="Client not found" description="This client reference is invalid." />;
  }

  return <FileBrowser clientId={clientId} />;
}
