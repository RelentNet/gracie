'use client';

import { PageContainer } from '@/components/ui/PageContainer';
import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
import { EmptyState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

/**
 * Module 3 — Upload (docs/08 §8 M3). Upload is an editor capability
 * (`file.upload`, D14) — Viewers cannot upload. Restricted content is hidden
 * entirely for unauthorized roles, mirroring the server.
 */
export default function UploadPage(): React.JSX.Element {
  const { can } = useAuth();

  if (!can('file.upload')) {
    return (
      <PageContainer className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Upload</h1>
        </header>
        <EmptyState
          title="Uploading is not available for your role"
          description="Your account has read-only access. Ask an administrator if you need to upload files."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PagePlaceholder
        title="Upload"
        description="Process transcripts and documents through the AI pipeline."
        emptyTitle="Ready to upload"
        emptyDescription="A client selector, multi-file picker, context/output prompts, and type selectors will appear here once the upload pipeline is connected."
      />
    </PageContainer>
  );
}
