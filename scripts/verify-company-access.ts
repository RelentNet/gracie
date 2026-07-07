/**
 * SECURITY VERIFICATION — company-aware Assistant access control (P6B.1).
 *
 * Proves the "mirror model": a viewer/standard user can NOT obtain, through the
 * assistant's gates, (a) a meeting transcript, (b) a restricted/admin-only folder
 * document, or (c) client financials (fee tier / contract value) — while an admin
 * can. It exercises the REAL, pure gate functions the feature runs in production:
 *   - `filterChunksForRole`  (@gracie/shared) — the transcript source-type gate.
 *   - `isFolderVisibleToRole` + `redactClientForCaller` (lib/assistant/company/
 *     access-policy) — the restricted-folder + financials mirrors.
 * and composes them exactly as the server-only `gateChunksForCaller` does
 * (filterChunksForRole → restricted-folder filter).
 *
 * The repo has no test runner; this runs directly on Node's TypeScript type
 * stripping and touches NO database, so it is deterministic and reviewable:
 *   node scripts/verify-company-access.ts
 * Exits non-zero if any assertion fails.
 */
import { filterChunksForRole } from '../packages/shared/src/ai/chat.ts';
import {
  isFolderVisibleToRole,
  redactClientForCaller,
  toCompanyCaller,
  type CompanyCaller,
  type FolderVisibility,
} from '../apps/web/lib/assistant/company/access-policy.ts';

// --- fixtures ----------------------------------------------------------------

const FOLDERS: Record<string, FolderVisibility> = {
  f_admin: { visibility: 'restricted', allowedRoles: ['admin'] }, // e.g. Transcripts
  f_all: { visibility: 'all', allowedRoles: ['admin', 'standard', 'viewer'] },
};

interface TestChunk {
  id: string;
  sourceType: 'transcript' | 'upload' | 'meeting_document' | 'knowledge_base';
  sourceId: string;
  content: string;
  similarity: number;
  folderId?: string;
}

const CHUNKS: TestChunk[] = [
  { id: 't', sourceType: 'transcript', sourceId: 'm1', content: 'TRANSCRIPT', similarity: 0.9 },
  { id: 'r', sourceType: 'upload', sourceId: 'd1', content: 'RESTRICTED_DOC', similarity: 0.8, folderId: 'f_admin' },
  { id: 'u', sourceType: 'upload', sourceId: 'd2', content: 'NORMAL_DOC', similarity: 0.7, folderId: 'f_all' },
  { id: 'k', sourceType: 'knowledge_base', sourceId: 'kb1', content: 'KB', similarity: 0.6 },
];

const CLIENT = {
  id: 'c1',
  name: 'Acme',
  type: 'client',
  feeTier: 'high',
  contractValue: 500_000,
  cadence: 'monthly',
  description: 'x',
} as const;

/** Compose the two shipped gates exactly as server-only `gateChunksForCaller` does. */
function gateChunks(chunks: TestChunk[], caller: CompanyCaller): TestChunk[] {
  const roleFiltered = filterChunksForRole(chunks as never, caller.isAdmin) as unknown as TestChunk[];
  return roleFiltered.filter((c) => {
    const folder = c.folderId !== undefined ? FOLDERS[c.folderId] : undefined;
    return folder === undefined || isFolderVisibleToRole(folder, caller);
  });
}

// --- assertions --------------------------------------------------------------

let failures = 0;
function check(label: string, pass: boolean): void {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failures += 1;
}

const CALLERS = {
  admin: toCompanyCaller({ userId: 'u_admin', role: 'admin' }),
  standard: toCompanyCaller({ userId: 'u_std', role: 'standard' }),
  viewer: toCompanyCaller({ userId: 'u_view', role: 'viewer' }),
};

for (const [name, caller] of Object.entries(CALLERS)) {
  const isAdmin = caller.isAdmin;
  console.log(`\nRole: ${name} (isAdmin=${isAdmin})`);

  const gated = gateChunks(CHUNKS, caller);
  const ids = new Set(gated.map((c) => c.id));

  // (a) transcripts — admin only
  check('transcript chunk visible ⇔ admin', ids.has('t') === isAdmin);
  // (b) restricted/admin-only folder doc — admin only
  check('restricted-folder doc chunk visible ⇔ admin', ids.has('r') === isAdmin);
  // controls: everyone sees normal doc + KB
  check('normal doc chunk visible to all', ids.has('u'));
  check('knowledge-base chunk visible to all', ids.has('k'));

  // (c) client financials — admin only
  const redacted = redactClientForCaller(CLIENT as never, caller);
  check('feeTier present ⇔ admin', (redacted.feeTier !== null) === isAdmin);
  check('contractValue present ⇔ admin', (redacted.contractValue !== null) === isAdmin);
  // non-financial fields always survive
  check('name preserved', redacted.name === 'Acme');
}

console.log(
  failures === 0
    ? '\nALL SECURITY CHECKS PASSED ✔'
    : `\n${failures} SECURITY CHECK(S) FAILED ✗`,
);
process.exit(failures === 0 ? 0 : 1);
