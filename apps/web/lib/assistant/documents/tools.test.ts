/**
 * Self-checks for the pure bits of the create_document assistant tool: strict
 * client-name resolution and the role gate. No DB, no HTTP — the write deps are
 * stubbed. Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Client, Folder } from '@gracie/shared';

import {
  matchClient,
  runCreateDocument,
  type ClientRef,
  type CreateDocumentDeps,
} from './create-document';

// --- matchClient (pure) -------------------------------------------------------

const CLIENTS: ClientRef[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'DSS Advisors', initials: 'DSS' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Acme Capital', initials: 'AC' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Acme Holdings', initials: 'AH' },
];

test('matchClient: exact name wins', () => {
  const r = matchClient(CLIENTS, 'DSS Advisors');
  assert.equal(r.status, 'ok');
  assert.equal(r.status === 'ok' && r.client.id, '11111111-1111-1111-1111-111111111111');
});

test('matchClient: initials resolve', () => {
  const r = matchClient(CLIENTS, 'dss');
  assert.equal(r.status === 'ok' && r.client.name, 'DSS Advisors');
});

test('matchClient: unique substring resolves', () => {
  const r = matchClient(CLIENTS, 'advisors');
  assert.equal(r.status === 'ok' && r.client.name, 'DSS Advisors');
});

test('matchClient: uuid resolves', () => {
  const r = matchClient(CLIENTS, '22222222-2222-2222-2222-222222222222');
  assert.equal(r.status === 'ok' && r.client.name, 'Acme Capital');
});

test('matchClient: unknown name → unknown', () => {
  assert.equal(matchClient(CLIENTS, 'Globex').status, 'unknown');
});

test('matchClient: unknown uuid → unknown', () => {
  assert.equal(matchClient(CLIENTS, '99999999-9999-9999-9999-999999999999').status, 'unknown');
});

test('matchClient: ambiguous substring → ambiguous with candidates', () => {
  const r = matchClient(CLIENTS, 'acme');
  assert.equal(r.status, 'ambiguous');
  assert.deepEqual(r.status === 'ambiguous' && [...r.matches], ['Acme Capital', 'Acme Holdings']);
});

test('matchClient: empty → unknown', () => {
  assert.equal(matchClient(CLIENTS, '   ').status, 'unknown');
});

// --- runCreateDocument role gate + happy path ---------------------------------

function fullClient(ref: ClientRef): Client {
  return { ...(ref as unknown as Client) };
}

/** Deps that record the insert input; every method returns a canned value. */
function stubDeps(): { deps: CreateDocumentDeps; inserted: { value?: unknown } } {
  const inserted: { value?: unknown } = {};
  const deps: CreateDocumentDeps = {
    listClients: async () => CLIENTS.map(fullClient),
    listFolders: async () => [] as Folder[],
    ensureUploadFolder: async (_clientId, slug) => ({
      folderId: 'folder-1',
      folderPath: `clients/${slug}/uploads`,
    }),
    clientSlug: (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    buildUploadKey: (folderPath, fileName) => `${folderPath}/${fileName}`,
    putObject: async () => {},
    insertUploadDocument: async (input) => {
      inserted.value = input;
      return 'doc-123';
    },
    enqueueIngest: async () => 'job-1',
  };
  return { deps, inserted };
}

test('runCreateDocument: viewer is denied and never touches storage', async () => {
  const { deps } = stubDeps();
  // Any IO would throw here — proves the gate returns before touching deps.
  const denyingDeps: CreateDocumentDeps = {
    ...deps,
    listClients: async () => {
      throw new Error('should not run for a viewer');
    },
  };
  const res = await runCreateDocument(
    { client: 'DSS', title: 'Notes', content: 'hello' },
    { userId: 'u1', role: 'viewer' },
    denyingDeps,
  );
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : '', /permission/i);
});

test('runCreateDocument: editor saves into the Uploads folder', async () => {
  const { deps, inserted } = stubDeps();
  const res = await runCreateDocument(
    { client: 'DSS Advisors', title: 'Q3 plan', content: '# Plan\nbody' },
    { userId: 'u1', role: 'standard' },
    deps,
  );
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.documentId, 'doc-123');
    assert.equal(res.client, 'DSS Advisors');
    assert.equal(res.folder, 'Uploads');
    assert.equal(res.title, 'Q3 plan.md');
  }
  // The uploader id is the fixed turn identity, not from args.
  assert.equal((inserted.value as { uploadedByUserId?: string }).uploadedByUserId, 'u1');
  assert.equal((inserted.value as { source_badge?: string }).source_badge, undefined); // set by the insert helper, not here
});

test('runCreateDocument: unknown client → clear error, no write', async () => {
  const { deps, inserted } = stubDeps();
  const res = await runCreateDocument(
    { client: 'Globex', title: 'x', content: 'y' },
    { userId: 'u1', role: 'admin' },
    deps,
  );
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : '', /No client matches/i);
  assert.equal(inserted.value, undefined);
});

test('runCreateDocument: ambiguous client → error listing candidates', async () => {
  const { deps } = stubDeps();
  const res = await runCreateDocument(
    { client: 'Acme', title: 'x', content: 'y' },
    { userId: 'u1', role: 'admin' },
    deps,
  );
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : '', /Acme Capital.*Acme Holdings/);
});

test('runCreateDocument: empty content → error', async () => {
  const { deps } = stubDeps();
  const res = await runCreateDocument(
    { client: 'DSS', title: 'x', content: '   ' },
    { userId: 'u1', role: 'admin' },
    deps,
  );
  assert.equal(res.ok, false);
});
