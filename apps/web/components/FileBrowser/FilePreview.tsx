'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import type { Document } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Markdown } from '@/components/ui/Markdown';
import { Button } from '@/components/ui/Button';
import { LoadingState, ErrorState } from '@/components/ui/StateViews';
import { fileKind } from '@/components/FileBrowser/file-kind';
import { downloadDocument } from '@/components/FileBrowser/FileList';

/**
 * FilePreview — right-hand pane of the file browser. Selecting a file renders it
 * inline here instead of opening a new tab:
 *   - markdown (.md)  → the dependency-free {@link Markdown} renderer
 *   - text (.txt)     → wrapped <pre>
 *   - pdf             → native browser viewer in an <iframe> (presigned URL)
 *   - image           → <img> (presigned URL)
 *   - anything else   → "Preview not available" + Download
 *
 * CORS: `<iframe>`/`<img>` load the presigned URL cross-origin fine, but reading
 * .md/.txt TEXT needs a same-origin fetch — `/api/files/content` (same access
 * check as the presign route). Download is always available for every type.
 */
export interface FilePreviewProps {
  readonly document: Document | null;
  /** Mobile drawer close; omitted on desktop where the pane is always mounted. */
  readonly onClose?: () => void;
}

interface Loaded {
  readonly text: string | null;
  readonly url: string | null;
}

export function FilePreview({ document: doc, onClose }: FilePreviewProps): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ text: null, url: null });

  const key = doc?.r2Key ?? null;
  const kind = doc !== null ? fileKind(doc.r2Key) : 'other';

  useEffect(() => {
    if (doc === null || key === null) return;
    let active = true;
    setError(null);
    setLoaded({ text: null, url: null });

    const needsText = kind === 'markdown' || kind === 'text';
    const needsUrl = kind === 'pdf' || kind === 'image';
    if (!needsText && !needsUrl) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const load = async (): Promise<void> => {
      if (needsText) {
        const { text } = await apiClient.get<{ text: string }>(
          `/api/files/content?key=${encodeURIComponent(key)}`,
        );
        if (active) setLoaded({ text, url: null });
      } else {
        const { url } = await apiClient.get<{ url: string }>(
          `/api/files/url?key=${encodeURIComponent(key)}&action=get`,
        );
        if (active) setLoaded({ text: null, url });
      }
    };
    load()
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load preview');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return (): void => {
      active = false;
    };
  }, [doc, key, kind]);

  if (doc === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <FileText aria-hidden="true" size={28} style={{ color: 'var(--text-secondary)' }} />
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Select a file to preview it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header
        className="flex shrink-0 items-center gap-2 border-b p-3"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <span className="min-w-0 flex-1 truncate" style={TYPE.bodyStrong} title={doc.fileName}>
          {doc.fileName}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download aria-hidden="true" size={14} />}
          onClick={(): void => {
            void downloadDocument(doc);
          }}
        >
          Download
        </Button>
        {onClose !== undefined ? (
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md lg:hidden"
            style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <LoadingState label="Loading preview…" />
        ) : error !== null ? (
          <ErrorState title="Couldn’t load preview" description={error} />
        ) : kind === 'markdown' && loaded.text !== null ? (
          <Markdown content={loaded.text} />
        ) : kind === 'text' && loaded.text !== null ? (
          <pre
            className="whitespace-pre-wrap break-words font-data"
            style={{ ...TYPE.body, margin: 0 }}
          >
            {loaded.text}
          </pre>
        ) : kind === 'pdf' && loaded.url !== null ? (
          <iframe
            src={loaded.url}
            title={doc.fileName}
            className="h-full min-h-[60vh] w-full rounded-md border"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        ) : kind === 'image' && loaded.url !== null ? (
          // Presigned MinIO URL, not a static asset — plain <img>, not next/image.
          <img
            src={loaded.url}
            alt={doc.fileName}
            className="mx-auto h-auto max-w-full rounded-md"
          />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border p-6" style={{ borderColor: 'var(--border-subtle)' }}>
            <p style={TYPE.bodyStrong}>Preview not available for this file type</p>
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              Download the file to open it in its native application.
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download aria-hidden="true" size={14} />}
              onClick={(): void => {
                void downloadDocument(doc);
              }}
            >
              Download
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
