import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CHANGELOG, CURRENT_RELEASE } from './changelog';

function parse(version: string): number[] {
  return version.split('.').map(Number);
}

function isNewer(a: string, b: string): boolean {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

test('changelog versions are valid semver, unique, and newest first', () => {
  for (const r of CHANGELOG) assert.match(r.version, /^\d+\.\d+\.\d+$/, r.version);
  for (let i = 1; i < CHANGELOG.length; i += 1) {
    assert.ok(isNewer(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version), `${CHANGELOG[i - 1]!.version} before ${CHANGELOG[i]!.version}`);
  }
});

test('root package.json version matches the newest changelog entry', () => {
  // Release checklist step 2 — the sidebar version and the deployed build must agree.
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  assert.equal(pkg.version, CURRENT_RELEASE.version);
});

test('every release has a date and at least one item', () => {
  for (const r of CHANGELOG) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.version);
    assert.ok(r.sections.some((s) => s.items.length > 0), r.version);
  }
});
