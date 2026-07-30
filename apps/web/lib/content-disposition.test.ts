import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attachmentDisposition } from './content-disposition';

test('plain ASCII name is used verbatim in both forms', () => {
  assert.equal(
    attachmentDisposition('report.pdf'),
    `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
  );
});

test('CRLF / header-injection chars are stripped from the ascii fallback', () => {
  const d = attachmentDisposition('a\r\nSet-Cookie: x.pdf');
  // No raw CR/LF may survive into the header value.
  assert.ok(!/[\r\n]/.test(d));
  assert.ok(d.includes('filename="a__Set-Cookie: x.pdf"'));
});

test('quotes and backslashes cannot break out of the quoted ascii filename', () => {
  const d = attachmentDisposition('a"b\\c.pdf');
  assert.ok(d.includes('filename="a_b_c.pdf"'));
});

test('unicode is dropped from ascii but preserved (encoded) in filename*', () => {
  const d = attachmentDisposition('café.pdf');
  assert.ok(d.includes('filename="caf_.pdf"'));
  assert.ok(d.includes("filename*=UTF-8''caf%C3%A9.pdf"));
});
