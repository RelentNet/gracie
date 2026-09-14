/**
 * Post-sign-in "return to where I was" path, validated so it can only ever point
 * back into this app. Anything else (absolute URLs, protocol-relative `//host`,
 * backslash tricks, control characters, auth routes that would loop) falls back
 * to null → /home. Pure; unit-tested (it's an open-redirect guard).
 */
export const RETURN_TO_COOKIE = 'ga_return_to';

const AUTH_PATHS = ['/login', '/sign-in', '/sign-out', '/callback'];

/** True if the string contains an ASCII control character (0x00–0x1F or 0x7F). */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (hasControlChar(value)) return null;
  const pathname = value.split(/[?#]/, 1)[0] ?? '';
  if (AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return value;
}
