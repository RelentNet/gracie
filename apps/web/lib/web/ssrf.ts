/**
 * PURE SSRF address/host classification for fetch_url (P6B.2). No `server-only`, no
 * DNS, no imports — so the exact predicates the fetch guard runs are also unit-
 * testable directly (scripts/verify-ssrf-guard.ts) with no network or build step.
 *
 * The server-only fetch guard (lib/web/search.ts) resolves each URL's host to IP
 * addresses and rejects the request if ANY resolved address is private (this file),
 * blocking cloud-metadata endpoints, loopback, LAN, CGNAT, and internal services.
 */

/** True for internal hostnames that must never be fetched, regardless of DNS. */
export function isBlockedHostname(host: string): boolean {
  return /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host);
}

/**
 * True for loopback / private / link-local / CGNAT / ULA addresses (IPv4 + IPv6).
 * A malformed address returns `true` (fail closed — never fetch what we can't
 * classify). Cloud-metadata `169.254.169.254` is covered by the link-local range.
 */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true; // malformed → fail closed
    }
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 127) return true; // this-host / loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // Past here an address must be IPv6 (contains ':'). Anything that is neither a
  // dotted IPv4 nor a colon'd IPv6 is not an address at all → fail closed.
  if (!ip.includes(':')) return true;

  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] !== undefined) return isPrivateAddress(mapped[1]); // IPv4-mapped
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  return false;
}
