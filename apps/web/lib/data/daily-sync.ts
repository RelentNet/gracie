/**
 * Daily Sync read data layer (P7 §6). Reads `daily_syncs` rows (written by the
 * worker's daily-sync processor) for the Today + Yesterday tabs. The stored
 * `content` jsonb is the {@link DailySyncContent} contract; this parses it
 * defensively (a legacy/partial row degrades to null rather than throwing).
 *
 * Server-only; service-role client. The digest is firm-wide (not per-user), so no
 * caller scoping is applied here — every staffer sees the same morning sync.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Json } from '@gracie/db';
import type { DailySyncContent } from '@gracie/shared';

const ET = 'America/New_York';

/** The ET calendar date (YYYY-MM-DD) for an instant. */
export function easternDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** A daily-sync record for the UI. `content` is null for a malformed/legacy row. */
export interface DailySyncRecord {
  readonly syncDate: string;
  readonly content: DailySyncContent | null;
  readonly generatedAt: string | null;
  readonly deliveredAt: string | null;
}

/** Narrow a stored jsonb value to {@link DailySyncContent} (defensive). */
function parseContent(value: Json): DailySyncContent | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== 1) return null;
  // Trust the worker's shape for the rest; the reader only hard-requires the arrays
  // it maps over, so coerce those to arrays defensively.
  return {
    version: 1,
    generatedAtIso: typeof rec.generatedAtIso === 'string' ? rec.generatedAtIso : '',
    yesterday: (rec.yesterday as DailySyncContent['yesterday']) ?? {
      meetingsProcessed: 0,
      documentsGenerated: 0,
      tasksCreated: 0,
      tasksCompleted: 0,
    },
    todayMeetings: Array.isArray(rec.todayMeetings) ? (rec.todayMeetings as DailySyncContent['todayMeetings']) : [],
    atRiskClients: Array.isArray(rec.atRiskClients) ? (rec.atRiskClients as DailySyncContent['atRiskClients']) : [],
    briefs: Array.isArray(rec.briefs) ? (rec.briefs as DailySyncContent['briefs']) : [],
  };
}

/** Fetch the daily-sync row for a specific ET date (YYYY-MM-DD), or null. */
export async function getDailySync(syncDate: string): Promise<DailySyncRecord | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('daily_syncs')
    .select('sync_date, content, generated_at, delivered_at')
    .eq('sync_date', syncDate)
    .maybeSingle();
  if (error !== null) throw new Error(`get daily sync: ${error.message}`);
  if (data === null) return null;
  return {
    syncDate: data.sync_date,
    content: parseContent(data.content),
    generatedAt: data.generated_at,
    deliveredAt: data.delivered_at,
  };
}

/** The Today + Yesterday syncs plus their ET dates, for the Daily Sync page. */
export interface TodayYesterdaySyncs {
  readonly todayDate: string;
  readonly yesterdayDate: string;
  readonly today: DailySyncRecord | null;
  readonly yesterday: DailySyncRecord | null;
}

/** Load the Today + Yesterday syncs in one call. */
export async function getTodayAndYesterday(): Promise<TodayYesterdaySyncs> {
  const now = new Date();
  const todayDate = easternDateString(now);
  const yesterdayDate = easternDateString(new Date(now.getTime() - 86_400_000));
  const [today, yesterday] = await Promise.all([getDailySync(todayDate), getDailySync(yesterdayDate)]);
  return { todayDate, yesterdayDate, today, yesterday };
}
