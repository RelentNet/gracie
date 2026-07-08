/**
 * SECURITY VERIFICATION — fetch_url SSRF address guard (P6B.2).
 *
 * Exercises the REAL pure predicates the web fetch guard runs (lib/web/ssrf.ts):
 * public addresses/hosts are allowed; loopback/private/link-local/CGNAT/ULA and
 * internal hostnames (incl. cloud-metadata 169.254.169.254) are blocked; malformed
 * input fails closed. No network, no build step:
 *   node scripts/verify-ssrf-guard.ts
 * Exits non-zero on any failure.
 */
import { isBlockedHostname, isPrivateAddress } from '../apps/web/lib/web/ssrf.ts';

let failures = 0;
function check(label: string, pass: boolean): void {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failures += 1;
}

// Addresses that MUST be allowed (public).
const PUBLIC_IPS = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '11.0.0.1', '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111'];
// Addresses that MUST be blocked (private / loopback / link-local / CGNAT / ULA).
const PRIVATE_IPS = ['127.0.0.1', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'];
// Malformed → fail closed (blocked).
const MALFORMED = ['999.1.1.1', '10.0.0', 'not-an-ip', ''];

console.log('Public IPs — must be ALLOWED:');
for (const ip of PUBLIC_IPS) check(`${ip} allowed`, isPrivateAddress(ip) === false);

console.log('\nPrivate/internal IPs — must be BLOCKED:');
for (const ip of PRIVATE_IPS) check(`${ip} blocked`, isPrivateAddress(ip) === true);

console.log('\nMalformed addresses — must FAIL CLOSED (blocked):');
for (const ip of MALFORMED) check(`${JSON.stringify(ip)} blocked`, isPrivateAddress(ip) === true);

console.log('\nHostnames — internal must be BLOCKED, public ALLOWED:');
for (const h of ['localhost', 'foo.local', 'svc.internal', 'metadata.google.internal']) {
  check(`${h} blocked`, isBlockedHostname(h) === true);
}
for (const h of ['example.com', 'fnit.us', 'google.com', 'searxng.mycompany.com']) {
  check(`${h} allowed`, isBlockedHostname(h) === false);
}

console.log(failures === 0 ? '\nALL SSRF CHECKS PASSED ✔' : `\n${failures} SSRF CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
