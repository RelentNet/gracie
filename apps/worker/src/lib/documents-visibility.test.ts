/**
 * Tests for the shared folder/document visibility resolver and the path-boundary
 * helper (`packages/shared/src/permissions/visibility.ts`).
 *
 * These live here because `apps/worker` owns the repo's test runner. They are pure
 * unit tests over `@gracie/shared` — no DB, no Redis.
 *
 * All three behaviours under test replaced code that was subtly wrong:
 *   - `allowed_roles` used to be ignored (every restricted folder was admin-only).
 *   - a per-file override had no ceiling concept because per-file ACLs did not exist.
 *   - path matching used a bare `startsWith`, so sibling folders could govern each
 *     other. That one now decides who may DELETE things, which is why it has the most
 *     coverage here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canRoleSee,
  canRoleSeeDocument,
  isUnderPath,
  toVisibilityRule,
} from '@gracie/shared';

const OPEN = { visibility: 'all' as const, allowedRoles: ['admin', 'standard', 'viewer'] as const };
const ADMIN_ONLY = { visibility: 'restricted' as const, allowedRoles: ['admin'] as const };
const ADMIN_AND_STANDARD = {
  visibility: 'restricted' as const,
  allowedRoles: ['admin', 'standard'] as const,
};

describe('canRoleSee', () => {
  it('lets every role see an unrestricted folder', () => {
    for (const role of ['admin', 'standard', 'viewer'] as const) {
      assert.equal(canRoleSee(OPEN, role), true);
    }
  });

  it('treats an absent rule as unrestricted', () => {
    // Keys under no managed folder stay accessible — folders are the restriction
    // layer, so absence of a folder must not become a denial.
    assert.equal(canRoleSee(null, 'viewer'), true);
  });

  it('hides an admin-only folder from standard and viewer', () => {
    assert.equal(canRoleSee(ADMIN_ONLY, 'standard'), false);
    assert.equal(canRoleSee(ADMIN_ONLY, 'viewer'), false);
  });

  it('honours a multi-role allow list — the capability the old code could not express', () => {
    // Before this change every consumer tested `allowedRoles.includes('admin')` and
    // nothing else, so this folder was hidden from `standard` despite naming it.
    assert.equal(canRoleSee(ADMIN_AND_STANDARD, 'standard'), true);
    assert.equal(canRoleSee(ADMIN_AND_STANDARD, 'viewer'), false);
  });

  it('always lets admins through, even when the stored list omits them', () => {
    // Admins hold folder.viewRestricted, so the array can never lock them out. The UI
    // relies on this to keep the Admin checkbox disabled rather than lying.
    const noAdmin = { visibility: 'restricted' as const, allowedRoles: ['viewer'] as const };
    assert.equal(canRoleSee(noAdmin, 'admin'), true);
  });

  it('denies non-admins when a restricted rule names nobody', () => {
    const empty = { visibility: 'restricted' as const, allowedRoles: [] as const };
    assert.equal(canRoleSee(empty, 'standard'), false);
    assert.equal(canRoleSee(empty, 'admin'), true);
  });
});

describe('toVisibilityRule', () => {
  it('returns null when a document expresses no override (inherit)', () => {
    assert.equal(toVisibilityRule(null, null), null);
    assert.equal(toVisibilityRule(null, ['admin']), null);
  });

  it('treats a visibility with no roles as expressed, not absent', () => {
    assert.deepEqual(toVisibilityRule('restricted', null), {
      visibility: 'restricted',
      allowedRoles: [],
    });
  });
});

describe('canRoleSeeDocument — the folder is a ceiling', () => {
  it('inherits the folder when the file has no override', () => {
    assert.equal(canRoleSeeDocument(ADMIN_ONLY, null, 'standard'), false);
    assert.equal(canRoleSeeDocument(OPEN, null, 'standard'), true);
  });

  it('lets an override LOCK DOWN a file inside an open folder', () => {
    assert.equal(canRoleSeeDocument(OPEN, ADMIN_ONLY, 'standard'), false);
    assert.equal(canRoleSeeDocument(OPEN, ADMIN_ONLY, 'admin'), true);
  });

  it('does NOT let an override open a file up inside a restricted folder', () => {
    // The security property: an override must never become a way to leak a document
    // out of a folder the role cannot see.
    assert.equal(canRoleSeeDocument(ADMIN_ONLY, OPEN, 'standard'), false);
    assert.equal(canRoleSeeDocument(ADMIN_ONLY, OPEN, 'viewer'), false);
  });

  it('applies both gates for a partially-permitted folder', () => {
    assert.equal(canRoleSeeDocument(ADMIN_AND_STANDARD, null, 'standard'), true);
    assert.equal(canRoleSeeDocument(ADMIN_AND_STANDARD, ADMIN_ONLY, 'standard'), false);
  });

  it('leaves an unfiled document governed only by its own override', () => {
    assert.equal(canRoleSeeDocument(null, null, 'viewer'), true);
    assert.equal(canRoleSeeDocument(null, ADMIN_ONLY, 'viewer'), false);
  });
});

describe('isUnderPath — segment boundary', () => {
  const RESTRICTED = 'clients/acme/transcripts';

  it('REGRESSION: a folder does not govern a same-prefixed sibling', () => {
    // The original bug. `startsWith` made the restricted Transcripts folder the
    // governing folder for an unrelated `transcripts-public` sibling — and, because
    // the longest match wins, it could also hand the wrong verdict back for keys that
    // genuinely belonged elsewhere. Delete authorization now runs through here.
    assert.equal(isUnderPath('clients/acme/transcripts-public/notes.md', RESTRICTED), false);
    assert.equal(isUnderPath('clients/acme/transcriptsX', RESTRICTED), false);
  });

  it('matches real descendants at any depth', () => {
    assert.equal(isUnderPath(`${RESTRICTED}/2026-01-01/a.txt`, RESTRICTED), true);
    assert.equal(isUnderPath(`${RESTRICTED}/nested/deep/b.txt`, RESTRICTED), true);
  });

  it('treats a path as containing itself (so a cascade includes the folder)', () => {
    assert.equal(isUnderPath(RESTRICTED, RESTRICTED), true);
  });

  it('does not match an ancestor or an unrelated path', () => {
    assert.equal(isUnderPath('clients/acme', RESTRICTED), false);
    assert.equal(isUnderPath('clients/other/transcripts/a.txt', RESTRICTED), false);
  });

  it('REGRESSION: a recursive delete stops at the subtree boundary', () => {
    // The same helper drives softDeleteFolderCascade. A LIKE 'path%' here would have
    // swept `uploads-private` into a delete of `uploads`.
    const folders = [
      'clients/acme/uploads',
      'clients/acme/uploads/proposals',
      'clients/acme/uploads-private',
      'clients/acme/uploads-private/secret',
      'clients/other/uploads',
    ];
    const swept = folders.filter((p) => isUnderPath(p, 'clients/acme/uploads'));
    assert.deepEqual(swept, ['clients/acme/uploads', 'clients/acme/uploads/proposals']);
  });
});
