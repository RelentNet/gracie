/**
 * Logto configuration, session handling + role resolution (docs/07 §5, docs/02 D4).
 *
 * Server-only. Until the Logto application is created (admin first-run) the
 * bootstrap secrets are unset, `isLogtoConfigured()` returns false, and callers
 * fall back to a mock identity so local development keeps working without auth.
 * Once the `LOGTO_*` env vars are present, the same code path activates real
 * session verification with no further changes.
 *
 * SESSION COMPATIBILITY. This used to be `@logto/next`'s server client. It is now the
 * same thing built on the Hono server: `@logto/node`'s `CookieStorage` under the SAME
 * cookie name (`logto_<appId>`) and the SAME encryption key, driving the same edge
 * client. Sessions issued before the move therefore still decode — nobody is signed
 * out by the migration. Cookies are read and written through Hono's request context
 * (`hono/context-storage`), which is what lets `getRequestUser()` & co. keep their
 * zero-argument signatures, exactly as Next's ambient `cookies()` did.
 */
import 'server-only';

import { getContext } from 'hono/context-storage';
import { getCookie, setCookie } from 'hono/cookie';
import {
  CookieStorage,
  type GetContextParameters,
  type LogtoConfig,
  type LogtoContext,
} from '@logto/node';
import LogtoClient from '@logto/node/edge';

import { isRole, type Role } from '@gracie/shared';

const endpoint = process.env.LOGTO_ENDPOINT;
const appId = process.env.LOGTO_APP_ID;
const appSecret = process.env.LOGTO_APP_SECRET;
const cookieSecret = process.env.LOGTO_COOKIE_SECRET;

/** App origin Logto redirects back to after sign-in/out. */
export const baseUrl =
  process.env.LOGTO_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * True only when every bootstrap Logto secret is present. Gates all Logto calls
 * so the app degrades to the mock identity before the Logto app exists.
 */
export function isLogtoConfigured(): boolean {
  return Boolean(endpoint && appId && appSecret && cookieSecret);
}

/** The Logto client config plus what the session cookie needs. */
export interface LogtoAppConfig extends LogtoConfig {
  readonly baseUrl: string;
  readonly cookieSecret: string;
  readonly cookieSecure: boolean;
}

/**
 * Logto config. Scopes include `roles` + `custom_data` so the app Role can be
 * resolved from either a custom `user_role`/`app_role` claim (preferred — set via
 * Logto's JWT customizer, read by the DB `auth_role()`) or Logto RBAC roles.
 */
export const logtoConfig: LogtoAppConfig = {
  endpoint: endpoint ?? '',
  appId: appId ?? '',
  appSecret: appSecret ?? '',
  baseUrl,
  cookieSecret: cookieSecret ?? '',
  // Follows the app's own scheme, not NODE_ENV: a production build served over plain
  // HTTP on a LAN would otherwise mark the session cookie Secure, the browser would
  // drop it, and every sign-in would loop back to /login.
  cookieSecure: baseUrl.startsWith('https://'),
  scopes: ['profile', 'email', 'roles', 'custom_data'],
};

/**
 * A Logto client bound to the current request's cookies, plus the URL it asked to
 * navigate to (sign-in/out produce a redirect instead of performing one).
 *
 * `writeCookies: false` mirrors `@logto/next`'s context reads (`ignoreCookieChange`):
 * resolving the session never rewrites the cookie — only sign-in, the callback and
 * sign-out do. That keeps token-refresh behaviour identical to before the move.
 */
async function createClient(
  config: LogtoAppConfig,
  { writeCookies }: { readonly writeCookies: boolean },
): Promise<{ client: LogtoClient; storage: CookieStorage; navigated: () => string | null }> {
  const c = getContext();
  let navigateUrl: string | null = null;
  const storage = new CookieStorage({
    encryptionKey: config.cookieSecret,
    cookieKey: `logto_${config.appId}`,
    isSecure: config.cookieSecure,
    getCookie: (name) => getCookie(c, name) ?? '',
    setCookie: (name, value, options) => {
      if (writeCookies) setCookie(c, name, value, options);
    },
  });
  await storage.init();
  const client = new LogtoClient(config, {
    storage,
    navigate: (url) => {
      navigateUrl = url;
    },
  });
  return { client, storage, navigated: () => navigateUrl };
}

/** Start sign-in; returns the Logto URL to redirect the browser to. */
export async function signInUrl(config: LogtoAppConfig, redirectUri: string): Promise<string> {
  const { client, navigated } = await createClient(config, { writeCookies: true });
  await client.signIn({ redirectUri });
  const url = navigated();
  if (url === null) throw new Error('Logto signIn did not produce a redirect URL');
  return url;
}

/**
 * Complete sign-in from the callback URL Logto redirected back to, and return the new
 * session's context.
 *
 * The context comes from the SAME client on purpose: Hono reads cookies from the
 * incoming request, so a fresh client in this request would still see the old
 * (signed-out) cookie. Next's cookie store reflected same-request writes; this
 * client's storage holds the new session in memory, which gives the same result.
 */
export async function handleSignInCallback(
  config: LogtoAppConfig,
  callbackUrl: string,
  parameters?: GetContextParameters,
): Promise<LogtoContext> {
  const { client } = await createClient(config, { writeCookies: true });
  await client.handleSignInCallback(callbackUrl);
  return client.getContext(parameters);
}

/** End the session; returns the Logto end-session URL to redirect the browser to. */
export async function signOutUrl(config: LogtoAppConfig, postSignOutUri: string): Promise<string> {
  const { client, storage, navigated } = await createClient(config, { writeCookies: true });
  await client.signOut(postSignOutUri);
  await storage.destroy();
  const url = navigated();
  if (url === null) throw new Error('Logto signOut did not produce a redirect URL');
  return url;
}

/**
 * Where a failed sign-in lands: the login page with a message, never a bare 500.
 * A misconfigured Logto app, an unreachable Logto, a cancelled or expired sign-in
 * all end here; the cause goes to the server log.
 */
export function signInFailedResponse(stage: string, error: unknown): Response {
  console.error(`sign-in failed (${stage}):`, error);
  return Response.redirect(new URL('/login?error=sign_in_failed', baseUrl), 307);
}

/** An unauthenticated context — what we degrade to when the session can't be resolved. */
const UNAUTHENTICATED_CONTEXT: LogtoContext = { isAuthenticated: false };

/**
 * Resolve the current session. NEVER throws. A stale/expired/rotated refresh token
 * makes Logto reject the silent token refresh with `invalid_grant`, and the SDK throws
 * a `LogtoRequestError`; outside a request (a script, a test) there is no context at
 * all. Every such failure degrades to "not authenticated" — functionally what an
 * unresolvable session is — so the app sends the user to a clean re-login (which
 * mints fresh tokens) instead of erroring. A healthy session is returned unchanged.
 */
export async function safeGetLogtoContext(
  config: LogtoAppConfig,
  parameters?: GetContextParameters,
): Promise<LogtoContext> {
  try {
    const { client } = await createClient(config, { writeCookies: false });
    return await client.getContext(parameters);
  } catch (error) {
    console.warn(
      'safeGetLogtoContext: could not resolve the Logto session, treating as unauthenticated:',
      error instanceof Error ? error.message : error,
    );
    return UNAUTHENTICATED_CONTEXT;
  }
}

/** Least-privilege default when no role claim is present. */
const DEFAULT_ROLE: Role = 'viewer';

/** Custom claim keys the DB `auth_role()` reads, in priority order. */
const ROLE_CLAIM_KEYS = ['user_role', 'app_role'] as const;

function roleFromValue(value: unknown): Role | null {
  return isRole(value) ? value : null;
}

function roleFromList(value: unknown): Role | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (isRole(entry)) return entry;
  }
  return null;
}

/**
 * Resolve the app Role from a Logto context, in order: the `user_role`/`app_role`
 * claim on the id token, the same key in userInfo, then Logto RBAC `roles`
 * arrays. Defaults to least privilege when nothing matches.
 */
export function resolveRole(context: LogtoContext): Role {
  const { claims, userInfo } = context;

  for (const key of ROLE_CLAIM_KEYS) {
    const fromClaim = roleFromValue(claims?.[key]) ?? roleFromValue(userInfo?.[key]);
    if (fromClaim !== null) return fromClaim;
  }

  return roleFromList(claims?.roles) ?? roleFromList(userInfo?.roles) ?? DEFAULT_ROLE;
}
