/**
 * PURE core of the `create_document` assistant tool — no `server-only`, no runtime
 * (value) imports of server modules, so the same functions the feature runs are
 * the ones the unit tests exercise with the write deps stubbed (mirrors the
 * pure/server split in ./company/access-policy.ts vs access.ts).
 *
 * The DB/storage-backed half lives in ./tools.ts, which builds the real deps and
 * wires the executor. This file never imports those directly — it takes them as an
 * injected {@link CreateDocumentDeps}.
 */
import { CLIENT_TYPES, type AITool, type Client, type ClientType, type Folder, type IngestJobPayload, type Role } from '@gracie/shared';

import type { UploadDocumentInput } from '../../data/uploads.js';

/** The fixed turn identity — never derived from tool arguments. */
export interface DocumentContext {
  /** INTERNAL `users.id` (uuid) of the asking user — stamped as the doc's uploader. */
  readonly userId: string;
  readonly role: Role;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The party types the client resolver searches (all of them, so a lead/partner resolves too). */
export const ALL_PARTY_TYPES: readonly ClientType[] = CLIENT_TYPES;

/**
 * Mirrors lib/data/files.ts `canEditRole` (admin + standard). Kept as a local
 * mirror — importing the real one pulls in `server-only` — and MUST stay in
 * lockstep with it, exactly as access-policy.ts mirrors the redaction rules.
 */
function isEditorRole(role: Role): boolean {
  return role === 'admin' || role === 'standard';
}

// --- pure client resolution (unit-tested) ------------------------------------

/** The subset of a client the resolver needs. */
export type ClientRef = Pick<Client, 'id' | 'name' | 'initials'>;

export type ClientMatch =
  | { readonly status: 'ok'; readonly client: ClientRef }
  | { readonly status: 'unknown' }
  | { readonly status: 'ambiguous'; readonly matches: readonly string[] };

/**
 * Resolve a client NAME or id to exactly one client — STRICTER than the read
 * tools' first-match resolver because this is a write: an unknown or ambiguous
 * name yields a clear error instead of silently picking one. Order: id (uuid) →
 * exact name → exact initials → unique substring; more than one candidate at a
 * given tier is reported as ambiguous with the candidate names.
 */
export function matchClient(clients: readonly ClientRef[], nameOrId: string): ClientMatch {
  const lower = nameOrId.trim().toLowerCase();
  if (lower === '') return { status: 'unknown' };

  if (UUID_RE.test(lower)) {
    const byId = clients.find((c) => c.id.toLowerCase() === lower);
    return byId !== undefined ? { status: 'ok', client: byId } : { status: 'unknown' };
  }

  for (const tier of [
    clients.filter((c) => c.name.toLowerCase() === lower),
    clients.filter((c) => c.initials.toLowerCase() === lower),
    clients.filter((c) => c.name.toLowerCase().includes(lower)),
  ]) {
    const [first] = tier;
    if (tier.length === 1 && first !== undefined) return { status: 'ok', client: first };
    if (tier.length > 1) return { status: 'ambiguous', matches: tier.map((c) => c.name) };
  }

  return { status: 'unknown' };
}

// --- tool result + arg coercion ----------------------------------------------

export type CreateDocumentResult =
  | { readonly ok: true; readonly documentId: string; readonly client: string; readonly folder: string; readonly title: string }
  | { readonly ok: false; readonly reason: string };

export function parseArgs(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A `.md` display name derived from the title. */
function markdownFileName(title: string): string {
  return /\.md$/i.test(title) ? title : `${title}.md`;
}

// --- injectable deps (real impls in ./tools.ts; stubbed in tests) ------------

export interface CreateDocumentDeps {
  readonly listClients: (types: readonly ClientType[]) => Promise<Client[]>;
  readonly listFolders: (clientId: string) => Promise<Folder[]>;
  readonly ensureUploadFolder: (
    clientId: string,
    slug: string,
    subtypeValue: string,
  ) => Promise<{ folderId: string; folderPath: string }>;
  readonly clientSlug: (name: string) => string;
  readonly buildUploadKey: (folderPath: string, fileName: string, now: Date) => string;
  readonly putObject: (key: string, body: Buffer, contentType?: string) => Promise<void>;
  readonly insertUploadDocument: (input: UploadDocumentInput) => Promise<string>;
  readonly enqueueIngest: (payload: IngestJobPayload) => Promise<string>;
}

// --- the handler --------------------------------------------------------------

/**
 * Save assistant-authored `content` as a `.md` document in a client's Documents.
 * Role-gated on the FIXED turn identity, resolves the client + destination folder,
 * stores the object, inserts the row (reusing `source_badge='upload'` via
 * insertUploadDocument), and enqueues ingest so it becomes searchable. Returns a
 * compact result the model can relay. This function itself does not catch — the
 * executor wraps it so any thrown IO error becomes `{ ok:false, reason }`.
 */
export async function runCreateDocument(
  args: Record<string, unknown>,
  ctx: DocumentContext,
  deps: CreateDocumentDeps,
): Promise<CreateDocumentResult> {
  // 1. Role gate — editors only (mirrors /api/upload). Viewers get a plain message.
  if (!isEditorRole(ctx.role)) {
    return { ok: false, reason: "You don't have permission to save documents — ask an admin or a standard user to save it." };
  }

  const clientArg = asString(args.client);
  const title = asString(args.title);
  const content = typeof args.content === 'string' ? args.content : '';
  const folderArg = asString(args.folder);
  if (clientArg === undefined) return { ok: false, reason: 'A client name or id is required.' };
  if (title === undefined) return { ok: false, reason: 'A document title is required.' };
  if (content.trim() === '') return { ok: false, reason: 'The document content is empty.' };

  // 2. Resolve the client (strict — unknown/ambiguous error clearly).
  const clients = await deps.listClients(ALL_PARTY_TYPES);
  const match = matchClient(clients, clientArg);
  if (match.status === 'unknown') {
    return { ok: false, reason: `No client matches "${clientArg}". Check the name and try again.` };
  }
  if (match.status === 'ambiguous') {
    return { ok: false, reason: `"${clientArg}" matches multiple clients (${match.matches.join(', ')}). Please be more specific.` };
  }
  const client = match.client;
  const slug = deps.clientSlug(client.name);

  // 3. Resolve the destination folder. A named folder is matched within the client;
  //    otherwise (or if the name doesn't match) fall back to the Uploads folder.
  let namedFolder: Folder | undefined;
  if (folderArg !== undefined) {
    const folders = await deps.listFolders(client.id);
    const q = folderArg.toLowerCase();
    namedFolder =
      folders.find((f) => f.displayName.toLowerCase() === q) ??
      folders.find((f) => f.displayName.toLowerCase().includes(q));
  }

  let folderId: string;
  let folderPath: string;
  let folderName: string;
  if (namedFolder !== undefined) {
    // SECURITY (mirrors /api/upload §D14): a restricted (Admin-only) folder needs admin.
    if (namedFolder.visibility === 'restricted' && ctx.role !== 'admin') {
      return { ok: false, reason: `The "${namedFolder.displayName}" folder is admin-only — an admin has to save into it.` };
    }
    folderId = namedFolder.id;
    folderPath = namedFolder.path;
    folderName = namedFolder.displayName;
  } else {
    const ensured = await deps.ensureUploadFolder(client.id, slug, 'other');
    folderId = ensured.folderId;
    folderPath = ensured.folderPath;
    folderName = 'Uploads';
  }

  // 4. Store the object, insert the row (reused upload badge), enqueue ingest.
  const now = new Date();
  const fileName = markdownFileName(title);
  const bytes = Buffer.from(content, 'utf8');
  const objectKey = deps.buildUploadKey(folderPath, fileName, now);

  await deps.putObject(objectKey, bytes, 'text/markdown');
  const documentId = await deps.insertUploadDocument({
    clientId: client.id,
    folderId,
    r2Key: objectKey,
    fileName,
    fileSize: bytes.byteLength,
    status: 'ready',
    uploadedByUserId: ctx.userId,
  });
  await deps.enqueueIngest({
    documentId,
    clientId: client.id,
    objectKey,
    fileName,
    mimeType: 'text/markdown',
  });

  return { ok: true, documentId, client: client.name, folder: folderName, title: fileName };
}

// --- tool spec ----------------------------------------------------------------

const CREATE_DOCUMENT_SPEC: AITool = {
  name: 'create_document',
  description:
    'Save a write-up you authored (a summary, memo, notes, plan, etc.) as a document in a client’s Documents area. ' +
    'Provide the client (a name or id — it must resolve to exactly one client), a title, and the content (markdown or ' +
    'plain text you wrote). It is stored as a .md file in that client’s Uploads folder by default, or in a named folder, ' +
    'and is then extracted + embedded so it becomes searchable. Only editors (admin/standard) can save; a viewer is told ' +
    'they lack permission. This is a REAL, reversible write (Documents has a recycle bin) — confirm conversationally what ' +
    'you saved and where, and never invent a document id.',
  parameters: {
    type: 'object',
    properties: {
      client: {
        type: 'string',
        description: 'The client this document belongs to — a client name (or part of it) or id. Must resolve to exactly one client.',
      },
      title: { type: 'string', description: 'A short, descriptive title, e.g. "Q3 planning notes".' },
      content: { type: 'string', description: 'The document body — markdown or plain text you wrote. Stored as the file content.' },
      folder: {
        type: 'string',
        description: 'Optional destination folder NAME within the client. Defaults to the client’s Uploads folder.',
      },
    },
    required: ['client', 'title', 'content'],
    additionalProperties: false,
  },
};

/** The document write-tool specs advertised to the model. */
export const DOCUMENT_TOOLS: readonly AITool[] = [CREATE_DOCUMENT_SPEC];

/** Fast membership test so the chat route can route names to this executor. */
export const DOCUMENT_TOOL_NAMES: ReadonlySet<string> = new Set(DOCUMENT_TOOLS.map((t) => t.name));
