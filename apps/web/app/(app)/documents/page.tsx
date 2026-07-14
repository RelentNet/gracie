'use client';

import { TYPE } from '@/lib/typography';
import { PageContainer } from '@/components/ui/PageContainer';
import { DriveBrowser } from '@/components/FileBrowser/DriveBrowser';

/**
 * Module 5 — Global Documents (docs/08 §8 M5, §7; p2fix §5).
 *
 * Firm-wide two-panel file browser: an All Clients tree (per-client subfolders →
 * that client's folder tree), a virtual Recent Documents node, and a Knowledge
 * Base nav link, with a Client column in the list. Editors can Upload / New Folder
 * / Move; viewers get a read-only browser.
 *
 * RESTRICTED-FOLDER RULE (docs/08 §1/§7, D14): documents in a restricted folder
 * (e.g. Transcripts) are OMITTED entirely for non-admins — enforced SERVER-SIDE by
 * `GET /api/documents` and `GET /api/folders`, mirrored client-side in DriveBrowser
 * as defense-in-depth.
 */
export default function DocumentsPage(): React.JSX.Element {
  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Documents</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Browse every client’s documents, recent activity, and the knowledge base.
        </p>
      </header>
      <DriveBrowser scope={{ kind: 'global' }} />
    </PageContainer>
  );
}
