/**
 * Safety gate for the demo seed scripts, which WIPE content tables.
 *
 * They run against a local Supabase by default. A hosted demo box is allowed only
 * when `DEMO_SEED_TARGET` names that exact host — a deliberate, per-target opt-in,
 * so a production URL can never be hit by accident (someone would have to type
 * prod's own hostname into the variable).
 */
export function assertDemoTarget(): void {
  const raw = process.env.SUPABASE_URL ?? '';
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error(`Refusing to run: SUPABASE_URL "${raw}" is not a valid URL.`);
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return;

  const allowed = process.env.DEMO_SEED_TARGET ?? '';
  if (allowed !== '' && allowed === host) return;

  throw new Error(
    `Refusing to run: SUPABASE_URL host "${host}" is not local. These scripts wipe ` +
      'content tables. To target a demo server on purpose, set DEMO_SEED_TARGET to ' +
      'exactly that host.',
  );
}
