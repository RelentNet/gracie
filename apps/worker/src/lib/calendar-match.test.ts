/**
 * Primary-org selection tests (calendar-match). The regression that matters:
 * a meeting attended by a CLIENT and a PARTNER must home to the client, no
 * matter which org was created first — the real "Grace & Philips" series filed
 * its documents under the partner (Ble-Llc) because the partner was the
 * earlier-created match. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveMeetingOrgs, type OrgDomainEntry } from './calendar-match.js';

const INTERNAL = new Set(['graceandassociates.com']);

function org(clientId: string, domain: string, createdAt: string, isClient: boolean): OrgDomainEntry {
  return { clientId, domain, createdAt, isClient };
}

function resolve(domainToOrg: ReadonlyMap<string, OrgDomainEntry>, emails: string[]) {
  return resolveMeetingOrgs(
    {
      attendees: emails.map((email) => ({ email, name: null })),
      organizerEmail: 'allie@graceandassociates.com',
    },
    { internalDomains: INTERNAL, domainToOrg },
  );
}

test('REGRESSION: a client-type org beats an earlier-created partner for the primary slot', () => {
  const domainToOrg = new Map([
    ['ble-llc.com', org('ble', 'ble-llc.com', '2026-07-14T10:00:00Z', false)], // partner, created first
    ['philips.com', org('philips', 'philips.com', '2026-07-14T11:00:00Z', true)], // client, created later
  ]);
  const r = resolve(domainToOrg, ['a@ble-llc.com', 'b@philips.com']);
  assert.equal(r.primaryClientId, 'philips');
  assert.deepEqual(new Set(r.matchedClientIds), new Set(['ble', 'philips']));
});

test('two clients: earliest-created wins (unchanged behavior)', () => {
  const domainToOrg = new Map([
    ['first.com', org('first', 'first.com', '2026-01-01T00:00:00Z', true)],
    ['second.com', org('second', 'second.com', '2026-02-01T00:00:00Z', true)],
  ]);
  const r = resolve(domainToOrg, ['a@first.com', 'b@second.com']);
  assert.equal(r.primaryClientId, 'first');
});

test('partner-only meeting still homes to the partner', () => {
  const domainToOrg = new Map([
    ['ble-llc.com', org('ble', 'ble-llc.com', '2026-07-14T10:00:00Z', false)],
  ]);
  const r = resolve(domainToOrg, ['a@ble-llc.com']);
  assert.equal(r.primaryClientId, 'ble');
});
