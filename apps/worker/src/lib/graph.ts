/**
 * Microsoft Graph — app-only (client-credentials) calendar reader (P4, docs/07
 * §6, docs/02 D5).
 *
 * The worker authenticates as the dedicated Entra app (NOT per-user OAuth) and
 * reads ONLY the calendars of members of `MS_CALENDAR_GROUP_ID`. An Exchange
 * Application Access Policy enforces that scope server-side: reading any mailbox
 * outside the group returns 403 by design, which `readCalendarView` tolerates
 * (logs + skips) so one un-provisioned mailbox never fails a whole scan.
 *
 * Dependency-free (`fetch`, no SDK) to mirror the provider/Recall adapters. The
 * app-only token is cached in-process and refreshed just before expiry.
 */
import type { FastifyBaseLogger } from 'fastify';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_SKEW_MS = 60_000;

/** Resolved Graph app credentials (from the worker env). */
export interface GraphConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly groupId: string;
}

/** A group member that maps to a mailbox we can read. */
export interface GraphMember {
  readonly id: string;
  /** Primary SMTP / UPN — matched to `users.email` (lower-cased). */
  readonly email: string;
  readonly name: string;
}

/** An attendee on a Graph event. */
export interface GraphAttendee {
  readonly email: string | null;
  /** `required` | `optional` | `resource`. */
  readonly type: string | null;
  readonly name: string | null;
}

/** The subset of a Graph calendar event the scan needs. */
export interface GraphEvent {
  /** Per-mailbox event id (differs across attendees' copies of the same meeting). */
  readonly id: string;
  /** Cross-mailbox meeting identifier — SAME on every attendee's copy (dedup key). */
  readonly iCalUId: string | null;
  readonly subject: string | null;
  /** Start instant in UTC (we request `Prefer: outlook.timezone="UTC"`). */
  readonly startUtc: string | null;
  readonly endUtc: string | null;
  readonly isCancelled: boolean;
  readonly joinUrl: string | null;
  readonly organizerEmail: string | null;
  readonly attendees: readonly GraphAttendee[];
}

/** Read the Graph app credentials from the environment, or null if unconfigured. */
export function getGraphConfig(): GraphConfig | null {
  const tenantId = process.env.MS_TENANT_ID?.trim();
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  const groupId = process.env.MS_CALENDAR_GROUP_ID?.trim();
  if (!tenantId || !clientId || !clientSecret || !groupId) return null;
  return { tenantId, clientId, clientSecret, groupId };
}

interface GraphRawUser {
  readonly '@odata.type'?: string;
  readonly id?: string;
  readonly mail?: string | null;
  readonly userPrincipalName?: string | null;
  readonly displayName?: string | null;
}

interface GraphRawEvent {
  readonly id?: string;
  readonly iCalUId?: string | null;
  readonly subject?: string | null;
  readonly isCancelled?: boolean;
  readonly start?: { readonly dateTime?: string | null } | null;
  readonly end?: { readonly dateTime?: string | null } | null;
  readonly onlineMeeting?: { readonly joinUrl?: string | null } | null;
  readonly onlineMeetingUrl?: string | null;
  readonly organizer?: { readonly emailAddress?: { readonly address?: string | null } | null } | null;
  readonly attendees?: ReadonlyArray<{
    readonly type?: string | null;
    readonly emailAddress?: { readonly address?: string | null; readonly name?: string | null } | null;
  }> | null;
}

interface GraphListResponse<T> {
  readonly value?: readonly T[];
  readonly '@odata.nextLink'?: string;
}

/** Raised when Graph returns a non-OK status; carries the HTTP status for callers. */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

/** App-only Graph client scoped to the calendar access group. */
export interface GraphClient {
  /** List the members of `MS_CALENDAR_GROUP_ID` that have a mailbox address. */
  listGroupMembers(): Promise<GraphMember[]>;
  /**
   * Read a member's events between two instants (ISO, UTC). Returns [] and logs
   * on a 403 (mailbox outside the access policy) so one member never fails a scan.
   */
  readCalendarView(memberId: string, startIso: string, endIso: string): Promise<GraphEvent[]>;
}

/** Build an app-only Graph client with an in-process token cache. */
export function createGraphClient(config: GraphConfig, logger: FastifyBaseLogger): GraphClient {
  let cachedToken: string | null = null;
  let tokenExpiresAt = 0;

  async function getToken(): Promise<string> {
    if (cachedToken !== null && Date.now() < tokenExpiresAt) return cachedToken;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GraphError(`Graph token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof json.access_token !== 'string' || json.access_token === '') {
      throw new GraphError('Graph token response had no access_token', res.status);
    }
    cachedToken = json.access_token;
    tokenExpiresAt = Date.now() + ((json.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS);
    return cachedToken;
  }

  /** GET an absolute Graph URL, returning parsed JSON. Throws GraphError on non-OK. */
  async function get<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
    const token = await getToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GraphError(`Graph GET ${url} failed (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** Follow `@odata.nextLink` pagination, collecting all pages' `value`. */
  async function getAllPages<T>(firstUrl: string, extraHeaders?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = firstUrl;
    // Bound pagination defensively so a runaway feed can't loop forever.
    for (let page = 0; next !== undefined && page < 50; page += 1) {
      const body: GraphListResponse<T> = await get<GraphListResponse<T>>(next, extraHeaders);
      if (body.value !== undefined) out.push(...body.value);
      next = body['@odata.nextLink'];
    }
    return out;
  }

  return {
    async listGroupMembers(): Promise<GraphMember[]> {
      const url =
        `${GRAPH_BASE}/groups/${config.groupId}/members` +
        `?$select=id,displayName,mail,userPrincipalName&$top=100`;
      const raw = await getAllPages<GraphRawUser>(url);
      const members: GraphMember[] = [];
      for (const u of raw) {
        // Only user-typed members have a mailbox we can read.
        if (u.id === undefined) continue;
        const email = (u.mail ?? u.userPrincipalName ?? '').trim().toLowerCase();
        if (email === '') continue;
        members.push({ id: u.id, email, name: (u.displayName ?? email).trim() });
      }
      return members;
    },

    async readCalendarView(memberId, startIso, endIso): Promise<GraphEvent[]> {
      const params = new URLSearchParams({
        startDateTime: startIso,
        endDateTime: endIso,
        $select: 'id,iCalUId,subject,start,end,isCancelled,onlineMeeting,onlineMeetingUrl,organizer,attendees',
        $top: '100',
        $orderby: 'start/dateTime',
      });
      const url = `${GRAPH_BASE}/users/${memberId}/calendarView?${params.toString()}`;
      let raw: GraphRawEvent[];
      try {
        raw = await getAllPages<GraphRawEvent>(url, { Prefer: 'outlook.timezone="UTC"' });
      } catch (error) {
        // 403 = mailbox outside the Application Access Policy; 404 = no mailbox.
        // Neither should fail the whole scan — log + skip this member.
        if (error instanceof GraphError && (error.status === 403 || error.status === 404)) {
          logger.warn({ memberId, status: error.status }, 'graph: calendar read denied — skipping member');
          return [];
        }
        throw error;
      }
      return raw
        .filter((e): e is GraphRawEvent & { id: string } => typeof e.id === 'string')
        .map((e) => ({
          id: e.id,
          iCalUId: typeof e.iCalUId === 'string' && e.iCalUId !== '' ? e.iCalUId : null,
          subject: e.subject ?? null,
          startUtc: normalizeGraphInstant(e.start?.dateTime ?? null),
          endUtc: normalizeGraphInstant(e.end?.dateTime ?? null),
          isCancelled: e.isCancelled === true,
          joinUrl: (e.onlineMeeting?.joinUrl ?? e.onlineMeetingUrl ?? null) || null,
          organizerEmail: (e.organizer?.emailAddress?.address ?? null)?.trim().toLowerCase() || null,
          attendees: (e.attendees ?? []).map((a) => ({
            email: (a.emailAddress?.address ?? null)?.trim().toLowerCase() || null,
            type: a.type ?? null,
            name: a.emailAddress?.name ?? null,
          })),
        }));
    },
  };
}

/**
 * Graph returns `start.dateTime` WITHOUT a timezone offset (e.g.
 * `2026-07-06T14:00:00.0000000`), the zone conveyed separately by the `Prefer`
 * header we set to UTC. Append `Z` so `Date`/Postgres read it as UTC, and return
 * a clean ISO instant. Returns null for absent/unparsable values.
 */
export function normalizeGraphInstant(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const iso = hasZone ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
