/**
 * Allowlist safety tests (P7 §3 — part of acceptance). Proves the outbound-email
 * choke-point can only ever reach `@graceandassociates.com` recipients:
 *   - `filterAllowedRecipients` drops `client@va.gov` / `someone@gmail.com`,
 *     keeps `x@graceandassociates.com` (case-insensitive), and fails closed.
 *   - `sendEmail` POSTs ONLY the allowlisted recipient on a mixed list, and
 *     never calls Resend at all when every recipient is external.
 *
 * Pure/dependency-injected: the Resend key, allowlist, and `fetch` are all stubbed
 * so no network or DB is touched. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addressDomain,
  filterAllowedRecipients,
  parseAllowedDomains,
  sendEmail,
  type EmailLogger,
  type SendEmailInput,
} from './resend.js';

const GA = new Set(['graceandassociates.com']);

/** A no-op logger — the tests assert on the send, not on logging. */
const silentLogger: EmailLogger = { warn: () => {}, info: () => {} };

/** A captured Resend POST (url + parsed JSON body). */
interface CapturedCall {
  readonly url: string;
  readonly body: { from: string; to: string[]; subject: string; html: string; text?: string };
}

/** Build a `fetch` stub that records calls and returns a Resend-style 200. */
function makeFetchStub(): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = ((url: string, init: { body: string }): Promise<Response> => {
    calls.push({ url, body: JSON.parse(init.body) as CapturedCall['body'] });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'resend_test_id' }),
      text: () => Promise.resolve(''),
    } as Response);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseInput = (to: string[]): SendEmailInput => ({
  from: 'gracie@graceandassociates.com',
  to,
  subject: 'Daily Sync',
  html: '<p>hi</p>',
});

test('addressDomain returns the lowercased domain after the last @', () => {
  assert.equal(addressDomain('X@GraceAndAssociates.com'), 'graceandassociates.com');
  assert.equal(addressDomain('weird@sub@va.gov'), 'va.gov');
  assert.equal(addressDomain('no-at-sign'), null);
  assert.equal(addressDomain('trailing@'), null);
});

test('parseAllowedDomains splits, trims, lowercases and ignores blanks', () => {
  assert.deepEqual(
    [...parseAllowedDomains(' GraceAndAssociates.com , , foo.com ')],
    ['graceandassociates.com', 'foo.com'],
  );
  assert.equal(parseAllowedDomains(null).size, 0);
  assert.equal(parseAllowedDomains('').size, 0);
});

test('filterAllowedRecipients keeps GA, drops va.gov + gmail (case-insensitive)', () => {
  const { allowed, dropped } = filterAllowedRecipients(
    ['client@va.gov', 'someone@gmail.com', 'X@GraceAndAssociates.com'],
    GA,
  );
  assert.deepEqual(allowed, ['X@GraceAndAssociates.com']);
  assert.deepEqual(dropped, ['client@va.gov', 'someone@gmail.com']);
});

test('filterAllowedRecipients fails closed on an empty allowlist', () => {
  const { allowed, dropped } = filterAllowedRecipients(
    ['x@graceandassociates.com'],
    new Set(),
  );
  assert.deepEqual(allowed, []);
  assert.deepEqual(dropped, ['x@graceandassociates.com']);
});

test('sendEmail sends ONLY the allowlisted recipient on a mixed list', async () => {
  const { fetchImpl, calls } = makeFetchStub();
  const result = await sendEmail(
    baseInput(['client@va.gov', 'lead@graceandassociates.com', 'ext@gmail.com']),
    { logger: silentLogger, apiKey: 'key_test', allowedDomains: GA, fetchImpl },
  );

  assert.equal(calls.length, 1, 'Resend called exactly once');
  assert.deepEqual(calls[0]?.body.to, ['lead@graceandassociates.com']);
  assert.deepEqual(result.delivered, ['lead@graceandassociates.com']);
  assert.deepEqual(result.dropped, ['client@va.gov', 'ext@gmail.com']);
  assert.equal(result.id, 'resend_test_id');
});

test('sendEmail no-ops (never calls Resend) when ALL recipients are external', async () => {
  const { fetchImpl, calls } = makeFetchStub();
  const result = await sendEmail(baseInput(['client@va.gov', 'someone@gmail.com']), {
    logger: silentLogger,
    apiKey: 'key_test',
    allowedDomains: GA,
    fetchImpl,
  });

  assert.equal(calls.length, 0, 'Resend must NOT be called');
  assert.equal(result.id, null);
  assert.deepEqual(result.delivered, []);
  assert.deepEqual(result.dropped, ['client@va.gov', 'someone@gmail.com']);
});

test('sendEmail throws on a non-OK Resend response (so BullMQ retries)', async () => {
  const failing = ((): Promise<Response> =>
    Promise.resolve({
      ok: false,
      status: 422,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('bad'),
    } as Response)) as unknown as typeof fetch;

  await assert.rejects(
    sendEmail(baseInput(['lead@graceandassociates.com']), {
      logger: silentLogger,
      apiKey: 'key_test',
      allowedDomains: GA,
      fetchImpl: failing,
    }),
    /HTTP 422/,
  );
});
