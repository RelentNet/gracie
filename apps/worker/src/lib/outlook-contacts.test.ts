/**
 * Outlook contacts import — mapping + dedupe tests. The two things that must not
 * regress: the Graph→Gracie field mapping (phone fallback, no-email skip) and the
 * fill-not-overwrite dedupe decision (idempotent re-runs, never clobber human edits).
 * Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GraphContactRaw } from './graph.js';
import { decideContactUpsert, mapGraphContact, type ExistingContact } from './outlook-contacts.js';

// --- mapGraphContact --------------------------------------------------------------

test('maps the documented Graph fields', () => {
  const raw: GraphContactRaw = {
    displayName: 'Dana Reyes',
    emailAddresses: [{ address: 'Dana@Acme.com', name: 'Dana' }],
    mobilePhone: '555-1000',
    businessPhones: ['555-2000'],
    jobTitle: 'CIO',
    companyName: 'Acme Corp',
  };
  assert.deepEqual(mapGraphContact(raw), {
    name: 'Dana Reyes',
    email: 'Dana@Acme.com',
    phone: '555-1000',
    title: 'CIO',
    company: 'Acme Corp',
  });
});

test('phone falls back to the first business phone when there is no mobile', () => {
  const m = mapGraphContact({
    displayName: 'Sam',
    emailAddresses: [{ address: 'sam@x.io' }],
    businessPhones: ['555-9999'],
  });
  assert.equal(m?.phone, '555-9999');
});

test('name falls back to the email when displayName is blank', () => {
  const m = mapGraphContact({ displayName: '  ', emailAddresses: [{ address: 'nobody@x.io' }] });
  assert.equal(m?.name, 'nobody@x.io');
});

test('a contact with no email is skipped (null)', () => {
  assert.equal(mapGraphContact({ displayName: 'No Email', emailAddresses: [] }), null);
  assert.equal(mapGraphContact({ displayName: 'No Email' }), null);
  assert.equal(mapGraphContact({ emailAddresses: [{ address: '   ' }] }), null);
});

test('blank optional fields normalize to null', () => {
  const m = mapGraphContact({
    displayName: 'Jo',
    emailAddresses: [{ address: 'jo@x.io' }],
    mobilePhone: '',
    jobTitle: '  ',
    companyName: '',
  });
  assert.deepEqual(m, { name: 'Jo', email: 'jo@x.io', phone: null, title: null, company: null });
});

// --- decideContactUpsert ----------------------------------------------------------

const SOURCE = 'outlook:joe@ga.com';
const mapped = {
  name: 'Dana Reyes',
  email: 'dana@acme.com',
  phone: '555-1000',
  title: 'CIO',
  company: 'Acme Corp',
} as const;

test('inserts when there is no existing contact', () => {
  const d = decideContactUpsert(null, mapped, SOURCE);
  assert.equal(d.action, 'insert');
  if (d.action === 'insert') {
    assert.deepEqual(d.row, {
      full_name: 'Dana Reyes',
      email: 'dana@acme.com',
      phone: '555-1000',
      title: 'CIO',
      company: 'Acme Corp',
      source: SOURCE,
    });
  }
});

test('fills only the empty fields of an existing contact', () => {
  const existing: ExistingContact = {
    id: 'c1',
    full_name: 'Dana Reyes',
    phone: null, // missing → fill
    title: 'Chief Information Officer', // present → keep (human edit)
    company: null, // missing → fill
    source: null, // missing → fill
  };
  const d = decideContactUpsert(existing, mapped, SOURCE);
  assert.equal(d.action, 'update');
  if (d.action === 'update') {
    assert.equal(d.id, 'c1');
    assert.deepEqual(d.patch, { phone: '555-1000', company: 'Acme Corp', source: SOURCE });
  }
});

test('skips (idempotent) when nothing is missing', () => {
  const existing: ExistingContact = {
    id: 'c1',
    full_name: 'Dana Reyes',
    phone: '555-0000',
    title: 'CIO',
    company: 'Acme Corp',
    source: 'outlook:earlier@ga.com',
  };
  const d = decideContactUpsert(existing, mapped, SOURCE);
  assert.equal(d.action, 'skip');
});

test('does not overwrite an existing phone with the imported one', () => {
  const existing: ExistingContact = {
    id: 'c1',
    full_name: 'Dana Reyes',
    phone: '555-0000',
    title: null,
    company: null,
    source: SOURCE,
  };
  const d = decideContactUpsert(existing, mapped, SOURCE);
  assert.equal(d.action, 'update');
  if (d.action === 'update') {
    assert.equal(d.patch.phone, undefined); // phone kept
    assert.deepEqual(d.patch, { title: 'CIO', company: 'Acme Corp' });
  }
});
