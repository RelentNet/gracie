/**
 * SERVER half of the `create_document` assistant tool — wires the real DB/storage
 * deps into the pure core (./create-document.ts) and exposes the executor the chat
 * route dispatches to.
 *
 * Unlike the automation actions (PROPOSE → Confirm), this is a REVERSIBLE internal
 * write (the Documents recycle bin can undo it), so the model confirms
 * conversationally and there is no separate confirm route. It REUSES the canonical
 * upload write-path (buildUploadKey / ensureUploadFolder / insertUploadDocument +
 * putObject + enqueueIngest) rather than reinventing object keys or the documents
 * insert, and reuses the `source_badge='upload'` badge that insert stamps — so NO
 * migration is needed. The caller identity (userId + role) is the FIXED turn
 * identity, passed in by the chat route and NEVER read from tool arguments.
 */
import 'server-only';

import { putObject } from '@gracie/shared/storage';

import { listClients } from '../../data/clients.js';
import { listFolders } from '../../data/documents.js';
import { buildUploadKey, clientSlug, ensureUploadFolder, insertUploadDocument } from '../../data/uploads.js';
import { enqueueIngest } from '../../queue.js';
import {
  parseArgs,
  runCreateDocument,
  type CreateDocumentDeps,
  type DocumentContext,
} from './create-document.js';

export { DOCUMENT_TOOLS, DOCUMENT_TOOL_NAMES } from './create-document.js';
export type { DocumentContext } from './create-document.js';

const REAL_DEPS: CreateDocumentDeps = {
  listClients,
  listFolders,
  ensureUploadFolder,
  clientSlug,
  buildUploadKey,
  putObject,
  insertUploadDocument,
  enqueueIngest,
};

/**
 * Execute the create_document tool. Never throws: bad JSON, unknown names, and
 * execution errors all return a JSON `{ ok:false, reason }` string (no stack) so
 * the tool loop keeps going and the model can explain gracefully. `ctx` is the
 * FIXED turn identity — arguments cannot change whose role/id is used.
 */
export async function executeDocumentTool(
  name: string,
  rawArgs: string,
  ctx: DocumentContext,
): Promise<string> {
  if (name !== 'create_document') return JSON.stringify({ ok: false, reason: `unknown tool: ${name}` });

  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch {
    return JSON.stringify({ ok: false, reason: 'invalid tool arguments (not valid JSON)' });
  }

  try {
    return JSON.stringify(await runCreateDocument(args, ctx, REAL_DEPS));
  } catch (error) {
    console.error('create_document failed:', error);
    return JSON.stringify({ ok: false, reason: 'Could not save the document — please try again.' });
  }
}
