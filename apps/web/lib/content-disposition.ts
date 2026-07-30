/**
 * Build an RFC 6266 `Content-Disposition: attachment` value from a (possibly
 * user-supplied) filename. Two forms: an ASCII-sanitized `filename="…"` fallback for
 * old clients, plus a UTF-8 `filename*` for everything else.
 *
 * SECURITY: the name reaches an HTTP response header, so control chars (esp. CR/LF),
 * quotes and backslashes are stripped from the ASCII form and the UTF-8 form is
 * percent-encoded — this is the header-injection guard, not cosmetic.
 */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
