'use client';

import { TYPE } from '@/lib/typography';
import { PageContainer } from '@/components/ui/PageContainer';
import { DriveBrowser } from '@/components/FileBrowser/DriveBrowser';

/**
 * Gracie Files (GF) — the shared staff/team working drive.
 *
 * A two-panel file browser over the internal "Grace & Associates" org's `staff/`
 * drive (`kind='staff'` folders), NOT tied to any client. All roles browse (viewer
 * read-only); editors upload / create folders / move; admins add restricted folders
 * and delete files/folders. Files are AI-indexed through the SAME ingest + retrieval
 * as client documents, so the company-aware Assistant can use them.
 *
 * RESTRICTED-FOLDER RULE (docs/02 §D14): files in a restricted staff folder are
 * OMITTED for non-admins — enforced SERVER-SIDE by `GET /api/staff/*`, mirrored in
 * DriveBrowser as defense-in-depth.
 */
export default function GracieFilesPage(): React.JSX.Element {
  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Gracie Files</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          The team’s shared working drive — upload, organize, and browse files that
          aren’t tied to a client. Everything here is searchable by Gracie.
        </p>
      </header>
      <DriveBrowser scope={{ kind: 'staff' }} />
    </PageContainer>
  );
}
