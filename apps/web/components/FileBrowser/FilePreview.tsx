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
 *   - markdown (.md)    → the dependency-free {@link Markdown} renderer
 *   - text (.txt)       → wrapped <pre>
 *   - csv / xlsx        → an HTML <table> (rows parsed/converted server-side)
 *   - docx              → formatted HTML (converted + sanitized server-side)
 *   - pdf               → native browser viewer in an <iframe> (presigned URL)
 *   - image incl. svg   → <img> (presigned URL — SVGs can't run scripts via <img>)
 *   - anything else     → "Preview not available" + Download
 *
 * CORS: `<iframe>`/`<img>` load the presigned URL cross-origin fine, but text /
 * table / docx content needs a same-origin fetch — `/api/files/content` (same
 * access check as the presign route). Download is always available for every type.
 */
export interface FilePreviewProps {
  readonly document: Document | null;
  /** Mobile drawer close; omitted on desktop where the pane is always mounted. */
  readonly onClose?: () => void;
}

/** Tagged union returned by `/api/files/content` (mirrors the route). */
type PreviewPayload =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'html'; readonly html: string };

interface Loaded {
  readonly text: string | null;
  readonly rows: readonly (readonly string[])[] | null;
  readonly html: string | null;
  readonly url: string | null;
}

const EMPTY: Loaded = { text: null, rows: null, html: null, url: null };

export function FilePreview({ document: doc, onClose }: FilePreviewProps): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);

  const key = doc?.r2Key ?? null;
  const kind = doc !== null ? fileKind(doc.r2Key) : 'other';

  useEffect(() => {
    if (doc === null || key === null) return;
    let active = true;
    setError(null);
    setLoaded(EMPTY);

    // Text / table / docx read their content through the same-origin route;
    // pdf & images (incl. svg) render straight from a presigned URL.
    const needsContent =
      kind === 'markdown' || kind === 'text' || kind === 'csv' || kind === 'docx' || kind === 'xlsx';
    const needsUrl = kind === 'pdf' || kind === 'image';
    if (!needsContent && !needsUrl) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const load = async (): Promise<void> => {
      if (needsContent) {
        const payload = await apiClient.get<PreviewPayload>(
          `/api/files/content?key=${encodeURIComponent(key)}`,
        );
        if (!active) return;
        if (payload.kind === 'text') setLoaded({ ...EMPTY, text: payload.text });
        else if (payload.kind === 'table') setLoaded({ ...EMPTY, rows: payload.rows });
        else setLoaded({ ...EMPTY, html: payload.html });
      } else {
        const { url } = await apiClient.get<{ url: string }>(
          `/api/files/url?key=${encodeURIComponent(key)}&action=get`,
        );
        if (active) setLoaded({ ...EMPTY, url });
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
        ) : (kind === 'csv' || kind === 'xlsx') && loaded.rows !== null ? (
          <PreviewTable rows={loaded.rows} />
        ) : kind === 'docx' && loaded.html !== null ? (
          // Sanitized server-side in `/api/files/content` (mammoth → strip
          // scripts/handlers/js: urls), so it is safe to render as HTML here.
          <div className="docx-preview" dangerouslySetInnerHTML={{ __html: loaded.html }} />
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

const CELL_STYLE = {
  border: '1px solid var(--border-subtle)',
  padding: '0.35rem 0.6rem',
  textAlign: 'left',
  verticalAlign: 'top',
} as const;

/**
 * Render CSV / XLSX rows as an HTML table. The first row is treated as the header;
 * body rows are padded to the header width so ragged spreadsheets stay aligned.
 * Wrapped in an `overflow-x-auto` region so a wide sheet never widens the pane.
 */
function PreviewTable({ rows }: { readonly rows: readonly (readonly string[])[] }): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        This file has no rows to preview.
      </p>
    );
  }
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse" style={{ ...TYPE.body, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={`h-${i}`}
                scope="col"
                style={{ ...CELL_STYLE, fontWeight: 600, whiteSpace: 'nowrap', background: 'var(--surface-muted)' }}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={`r-${ri}`}>
              {header.map((_, ci) => (
                <td key={`c-${ri}-${ci}`} style={CELL_STYLE}>
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
