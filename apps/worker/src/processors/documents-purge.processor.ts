/**
 * Documents recycle-bin purge sweep.
 *
 * Permanently destroys soft-deleted documents (and the folders they lived in) once
 * they are older than `documents_trash_retention_days`. This is the ONLY irreversible
 * step in the Documents management feature, so it is built to be boring and loud:
 *
 *  - KILL-SWITCHED. `documents_trash_purge_enabled` ships `'false'`. While off, the
 *    sweep still runs, still computes exactly what it would destroy, and logs it — so
 *    the operator can watch the bin behave for a full retention cycle and verify
 *    restore works before anything is actually deleted. Nothing about the selection
 *    logic differs between dry-run and live; only the destroy calls are skipped.
 *  - OBJECT DELETION IS BEST-EFFORT. A missing object must not abort the sweep or
 *    strand the row (same reasoning as the KB delete path). We log and continue, then
 *    still remove the row — an orphaned object is recoverable waste; a row that can
 *    never be purged is a permanent leak.
 *  - ROW ORDER. The object goes first, then the row. If we die in between we leak an
 *    object; the reverse would leave a row pointing at bytes that no longer exist,
 *    which the UI would render as a downloadable file that 404s.
 *  - FOLDERS LAST, AND ONLY WHEN EMPTY. A folder is removed only if no documents
 *    still reference it — including live ones, since restoring a single file out of a
 *    deleted batch legitimately leaves the folder live again.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';
import { deleteObject } from '@gracie/shared/storage';
import type { DocumentsPurgeJobPayload } from '@gracie/shared';

const RETENTION_SETTING_KEY = 'documents_trash_retention_days';
const ENABLED_SETTING_KEY = 'documents_trash_purge_enabled';

/** Mirrors the seeded default + web-side floor (lib/data/settings-documents.ts). */
const DEFAULT_RETENTION_DAYS = 60;
const MIN_RETENTION_DAYS = 1;

/** Outcome of one sweep (visible in Bull Board). */
export interface DocumentsPurgeResult {
  readonly enabled: boolean;
  readonly retentionDays: number;
  readonly documentsPurged: number;
  readonly foldersPurged: number;
  readonly objectsFailed: number;
}

/** Read a jsonb-encoded scalar string setting. */
async function readSetting(db: ServerClient, key: string): Promise<string | null> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`documents-purge: read ${key}: ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
}

async function loadRetentionDays(db: ServerClient): Promise<number> {
  const raw = await readSetting(db, RETENTION_SETTING_KEY);
  const parsed = raw === null ? NaN : Number.parseInt(raw.trim(), 10);
  const days = Number.isFinite(parsed) ? parsed : DEFAULT_RETENTION_DAYS;
  return Math.max(days, MIN_RETENTION_DAYS);
}

async function loadEnabled(db: ServerClient): Promise<boolean> {
  return (await readSetting(db, ENABLED_SETTING_KEY))?.trim() === 'true';
}

export function createDocumentsPurgeProcessor(
  log: FastifyBaseLogger,
): Processor<DocumentsPurgeJobPayload, DocumentsPurgeResult> {
  return async (job: Job<DocumentsPurgeJobPayload>): Promise<DocumentsPurgeResult> => {
    const db = getServerClient();
    const [retentionDays, enabled] = await Promise.all([loadRetentionDays(db), loadEnabled(db)]);
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

    const expiredDocs = await db
      .from('documents')
      .select('id, r2_key, file_name, folder_id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);
    if (expiredDocs.error !== null) {
      throw new Error(`documents-purge: select documents: ${expiredDocs.error.message}`);
    }
    const expiredFolders = await db
      .from('folders')
      .select('id, path')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);
    if (expiredFolders.error !== null) {
      throw new Error(`documents-purge: select folders: ${expiredFolders.error.message}`);
    }

    const docs = expiredDocs.data ?? [];
    const folders = expiredFolders.data ?? [];

    if (!enabled) {
      // Dry run. Log at WARN so it is visible without hunting: an operator who has
      // left the switch off unintentionally should notice the backlog building.
      log.warn(
        {
          enabled: false,
          retentionDays,
          wouldPurgeDocuments: docs.length,
          wouldPurgeFolders: folders.length,
          sample: docs.slice(0, 10).map((d) => d.file_name),
          source: job.data.source,
        },
        'documents-purge sweep (DRY RUN — documents_trash_purge_enabled is off)',
      );
      return {
        enabled: false,
        retentionDays,
        documentsPurged: 0,
        foldersPurged: 0,
        objectsFailed: 0,
      };
    }

    let documentsPurged = 0;
    let objectsFailed = 0;

    for (const doc of docs) {
      try {
        await deleteObject(doc.r2_key);
      } catch (cleanupError) {
        objectsFailed += 1;
        log.error(
          { documentId: doc.id, key: doc.r2_key, err: cleanupError },
          'documents-purge: object delete failed — removing the row anyway',
        );
      }

      // `embeddings.source_id` has no FK, so soft delete already cleared these. Repeat
      // it here as a backstop: a row soft-deleted before that logic shipped, or one
      // whose embedding cleanup failed, must not survive its document.
      const clearedEmbeddings = await db
        .from('embeddings')
        .delete()
        .eq('source_type', 'upload')
        .eq('source_id', doc.id);
      if (clearedEmbeddings.error !== null) {
        log.error(
          { documentId: doc.id, err: clearedEmbeddings.error },
          'documents-purge: embedding cleanup failed',
        );
      }

      const removed = await db.from('documents').delete().eq('id', doc.id);
      if (removed.error !== null) {
        log.error({ documentId: doc.id, err: removed.error }, 'documents-purge: row delete failed');
        continue;
      }
      documentsPurged += 1;
    }

    // Folders only once nothing references them any more.
    let foldersPurged = 0;
    for (const folder of folders) {
      const remaining = await db
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('folder_id', folder.id);
      if (remaining.error !== null) {
        log.error({ folderId: folder.id, err: remaining.error }, 'documents-purge: folder check failed');
        continue;
      }
      if ((remaining.count ?? 0) > 0) continue;

      const removed = await db.from('folders').delete().eq('id', folder.id);
      if (removed.error !== null) {
        log.error({ folderId: folder.id, err: removed.error }, 'documents-purge: folder delete failed');
        continue;
      }
      foldersPurged += 1;
    }

    log.info(
      {
        enabled: true,
        retentionDays,
        documentsPurged,
        foldersPurged,
        objectsFailed,
        source: job.data.source,
      },
      'documents-purge sweep',
    );
    return { enabled: true, retentionDays, documentsPurged, foldersPurged, objectsFailed };
  };
}
