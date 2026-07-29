/**
 * The 6 AM daily-sync digest email (P7 §6, editable-template DS). One email per
 * active staffer bundling yesterday's activity, today's schedule, at-risk clients,
 * that day's pre-meeting briefs, and optionally an AI-composed narrative. Internal/
 * team only — delivery is allowlist-gated by `sendEmail`.
 *
 * The BODY is rendered from an editable template of literal text + `{shortcode}`
 * tokens (`DAILY_SYNC_SHORTCODES`); the fixed HTML shell (`renderEmailLayout`) stays
 * locked here so the email chrome can't be broken from a Settings textarea. Each
 * shortcode maps to an HTML + plain-text renderer below; a lone unknown/not-yet-built
 * token renders EMPTY (never a literal `{token}`), and a blank template falls back to
 * the default. Deterministic except the optional `{ai_brief}`, which the caller
 * composes (grounded) and passes on `content`.
 */
import {
  DAILY_SYNC_SHORTCODE_CODES,
  resolveDailySyncTemplate,
  type DailySyncContent,
  type DailySyncShortcode,
} from '@gracie/shared';

import { box, button, escapeHtml, h2, muted, p, preText, renderEmailLayout, statRow, ul } from './layout.js';

/** Format an ISO instant as an Eastern-time clock label (e.g. "9:00 AM"). */
function formatEtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** One rendered email: subject + HTML + plain-text alternative. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Inputs for {@link renderDailySyncEmail}. */
export interface DailySyncEmailInput {
  readonly recipientName: string;
  /** Long ET date label for the header + subject (e.g. "Friday, July 10, 2026"). */
  readonly syncDateLabel: string;
  readonly content: DailySyncContent;
  /** App base URL for the "Open Daily Sync" link. */
  readonly appUrl: string;
  /** The editable body template (blank/absent → the shared default). */
  readonly template?: string;
}

/** A short meeting line: "9:00 AM — Title (Client) · lead Name". */
function meetingLine(m: DailySyncContent['todayMeetings'][number]): string {
  const time = formatEtTime(m.timeIso);
  const who = m.isInternal ? 'Internal' : (m.clientName ?? 'Unassigned');
  const lead = m.leadName !== null ? ` · lead ${m.leadName}` : '';
  return `${time} — ${m.title} (${who})${lead}`;
}

/** An at-risk client line: "Acme — health 42 · declining". */
function atRiskLine(c: DailySyncContent['atRiskClients'][number]): string {
  const health = c.health !== null ? `health ${c.health}` : 'health n/a';
  const trend = c.trend !== null ? ` · ${c.trend}` : '';
  return `${c.name} — ${health}${trend}`;
}

/** An open-to-do line: "Follow up on SOW (Acme) — due 2026-07-30 [priority]". */
function todoLine(t: NonNullable<DailySyncContent['lastWeekTodos']>[number]): string {
  const client = t.clientName !== null ? ` (${t.clientName})` : '';
  const due = t.dueDate !== null ? ` — due ${t.dueDate}` : '';
  const flag = t.priority ? ' [priority]' : '';
  return `${t.description}${client}${due}${flag}`;
}

/**
 * The link cluster ending each pre-meeting brief card — the "cockpit links out"
 * principle. History artifacts (Summary / notes / transcript) resolve to the
 * meeting-occurrence page `/meetings/[id]` (a route contract owned by a parallel
 * session); the client page is `/clients/[id]`. Absolute URLs off the same app base
 * the CTA button uses.
 *
 * ponytail: the three history labels all point at the meeting page — per-document
 * deep-links don't exist yet; swap in #summary/#notes/#transcript once the occurrence
 * page exposes section anchors.
 */
function meetingUrl(appUrl: string, meetingId: string): string {
  return `${appUrl}/meetings/${encodeURIComponent(meetingId)}`;
}

function briefLinksHtml(appUrl: string, brief: DailySyncContent['briefs'][number]): string {
  const mtg = meetingUrl(appUrl, brief.meetingId);
  const link = (label: string, href: string): string =>
    `<a href="${escapeHtml(href)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(label)}</a>`;
  const parts = [link('Summary', mtg), link('Last meeting notes', mtg), link('Transcript', mtg)];
  if (typeof brief.clientId === 'string' && brief.clientId !== '') {
    parts.push(link('Client page', `${appUrl}/clients/${encodeURIComponent(brief.clientId)}`));
  }
  return `<div style="margin:8px 0 0;font-size:12px;color:#6b7280;">${parts.join(' &middot; ')}</div>`;
}

function briefLinksText(appUrl: string, brief: DailySyncContent['briefs'][number]): string {
  const lines = [`    Summary / notes / transcript: ${meetingUrl(appUrl, brief.meetingId)}`];
  if (typeof brief.clientId === 'string' && brief.clientId !== '') {
    lines.push(`    Client page: ${appUrl}/clients/${encodeURIComponent(brief.clientId)}`);
  }
  return lines.join('\n');
}

/** One shortcode's renderers. `html` returns trusted HTML; `text` returns plain text. */
interface ShortcodeRenderer {
  readonly html: (content: DailySyncContent, input: DailySyncEmailInput) => string;
  readonly text: (content: DailySyncContent, input: DailySyncEmailInput) => string;
}

/** Section renderers, keyed by shortcode. Kept in sync with `DAILY_SYNC_SHORTCODES` (shared). */
const RENDERERS: Record<DailySyncShortcode, ShortcodeRenderer> = {
  // Inline codes return RAW text: they're only ever substituted into a text line,
  // which `renderDailySyncBody` then escapes once via `p()` — escaping here too would
  // double-escape names like "O'Brien" in the greeting.
  recipient_name: {
    html: (_c, i) => i.recipientName,
    text: (_c, i) => i.recipientName,
  },
  sync_date: {
    html: (_c, i) => i.syncDateLabel,
    text: (_c, i) => i.syncDateLabel,
  },
  yesterday_activity: {
    html: (c) => {
      const y = c.yesterday;
      const had = y.meetingsProcessed + y.documentsGenerated + y.tasksCreated + y.tasksCompleted > 0;
      return (
        h2('Yesterday') +
        (had
          ? statRow([
              { label: 'Meetings processed', value: y.meetingsProcessed },
              { label: 'Documents', value: y.documentsGenerated },
              { label: 'Tasks created', value: y.tasksCreated },
              { label: 'Tasks completed', value: y.tasksCompleted },
            ])
          : muted('No recorded activity yesterday.'))
      );
    },
    text: (c) => {
      const y = c.yesterday;
      return [
        'Yesterday:',
        `  Meetings processed: ${y.meetingsProcessed}`,
        `  Documents generated: ${y.documentsGenerated}`,
        `  Tasks created: ${y.tasksCreated}`,
        `  Tasks completed: ${y.tasksCompleted}`,
      ].join('\n');
    },
  },
  todays_meetings: {
    html: (c) =>
      h2("Today's meetings") +
      (c.todayMeetings.length > 0
        ? ul(c.todayMeetings.map(meetingLine))
        : muted('No meetings scheduled today.')),
    text: (c) =>
      ["Today's meetings:", ...(c.todayMeetings.length > 0 ? c.todayMeetings.map((m) => `  - ${meetingLine(m)}`) : ['  (none)'])].join(
        '\n',
      ),
  },
  tomorrows_meetings: {
    // Same shape as today's, over the next-day window — so nothing tomorrow is a surprise.
    html: (c) => {
      const rows = c.tomorrowMeetings ?? [];
      return h2("Tomorrow's meetings") + (rows.length > 0 ? ul(rows.map(meetingLine)) : muted('No meetings scheduled tomorrow.'));
    },
    text: (c) => {
      const rows = c.tomorrowMeetings ?? [];
      return ["Tomorrow's meetings:", ...(rows.length > 0 ? rows.map((m) => `  - ${meetingLine(m)}`) : ['  (none)'])].join('\n');
    },
  },
  team_out: {
    // Who is out/traveling today, from calendar out-of-office. RENDERS EMPTY: the OOO
    // feed is not ingested yet (calendar-scan fetches no showAs/type and skips solo OOO
    // blocks). Registered so a template can reference {team_out} today and light up when
    // the feed lands — never fabricated. See docs/plan/daily-sync-email-v2.md HONESTY RULE.
    html: () => '',
    text: () => '',
  },
  at_risk_clients: {
    // Empty → render NOTHING (no header, no "(none)"): health scores aren't calibrated
    // yet, so an empty section is noise. The whole block drops out via the render loop.
    html: (c) => (c.atRiskClients.length > 0 ? h2('Clients to watch') + ul(c.atRiskClients.map(atRiskLine)) : ''),
    text: (c) => (c.atRiskClients.length > 0 ? ['Clients to watch:', ...c.atRiskClients.map((x) => `  - ${atRiskLine(x)}`)].join('\n') : ''),
  },
  pre_meeting_briefs: {
    html: (c, i) => {
      if (c.briefs.length === 0) return h2('Pre-meeting briefs') + muted('No briefs for today’s meetings.');
      const boxes = c.briefs
        .map((b) => {
          const heading =
            `<div style="font-size:14px;font-weight:700;color:#10233f;margin:0 0 6px;">` +
            `${escapeHtml(b.title)}${b.clientName !== null ? ` · ${escapeHtml(b.clientName)}` : ''}</div>`;
          return box(heading + preText(b.content) + briefLinksHtml(i.appUrl, b));
        })
        .join('');
      return h2('Pre-meeting briefs') + boxes;
    },
    text: (c, i) =>
      [
        'Pre-meeting briefs:',
        ...(c.briefs.length > 0
          ? c.briefs.flatMap((b) => [
              `  # ${b.title}${b.clientName !== null ? ` · ${b.clientName}` : ''}`,
              ...b.content.split('\n').map((l) => `    ${l}`),
              briefLinksText(i.appUrl, b),
              '',
            ])
          : ['  (none)']),
      ].join('\n'),
  },
  last_week_todos: {
    html: (c) => {
      const todos = c.lastWeekTodos ?? [];
      return h2("Last week's open to-dos") + (todos.length > 0 ? ul(todos.map(todoLine)) : muted('No carried-over to-dos.'));
    },
    text: (c) => {
      const todos = c.lastWeekTodos ?? [];
      return ["Last week's open to-dos:", ...(todos.length > 0 ? todos.map((t) => `  - ${todoLine(t)}`) : ['  (none)'])].join('\n');
    },
  },
  ai_brief: {
    // Empty when disabled / compose failed (null/absent) — the shortcode simply vanishes.
    html: (c) => {
      const brief = c.aiBrief;
      if (typeof brief !== 'string' || brief.trim() === '') return '';
      return h2("Gracie's briefing") + box(preText(brief));
    },
    text: (c) => {
      const brief = c.aiBrief;
      if (typeof brief !== 'string' || brief.trim() === '') return '';
      return ["Gracie's briefing:", brief].join('\n');
    },
  },
  open_daily_sync_button: {
    html: (_c, i) => button('Open Daily Sync', `${i.appUrl}/daily-sync`),
    text: (_c, i) => `Open Daily Sync: ${i.appUrl}/daily-sync`,
  },
};

const INLINE_CODES = new Set<DailySyncShortcode>(['recipient_name', 'sync_date']);
const BLOCK_CODES = new Set<DailySyncShortcode>(DAILY_SYNC_SHORTCODE_CODES.filter((c) => !INLINE_CODES.has(c)));
/** Matches a line that is exactly one `{shortcode}` token (with optional surrounding space). */
const LONE_TOKEN = /^\{([a-z_]+)\}$/;

function isShortcode(code: string): code is DailySyncShortcode {
  return (DAILY_SYNC_SHORTCODE_CODES as readonly string[]).includes(code);
}

/** Replace inline `{recipient_name}`/`{sync_date}` tokens within a text line. */
function substituteInline(line: string, content: DailySyncContent, input: DailySyncEmailInput, mode: 'html' | 'text'): string {
  return line.replace(/\{([a-z_]+)\}/g, (whole, code: string) => {
    if (isShortcode(code) && INLINE_CODES.has(code)) return RENDERERS[code][mode](content, input);
    return whole; // unknown or block token in a text line → leave literal
  });
}

/**
 * Render the editable body template to HTML or plain text. A line that is exactly a
 * lone BLOCK shortcode expands to that section; any other non-blank line is literal
 * text (inline shortcodes substituted, HTML-escaped in `html` mode); unknown tokens
 * stay literal. Pure + deterministic — unit-tested.
 */
export function renderDailySyncBody(
  template: string,
  content: DailySyncContent,
  input: DailySyncEmailInput,
  mode: 'html' | 'text',
): string {
  const resolved = resolveDailySyncTemplate(template); // blank → default, never a blank email
  const out: string[] = [];
  for (const rawLine of resolved.split('\n')) {
    const trimmed = rawLine.trim();
    const loneMatch = LONE_TOKEN.exec(trimmed);
    const loneCode = loneMatch?.[1];
    if (loneCode !== undefined) {
      // A line that is exactly one `{token}`. A known BLOCK code expands to its
      // section; a known INLINE code falls through to substitution below. An unknown
      // or not-yet-built code renders EMPTY (never a literal `{token}`) — so a template
      // can safely reference a shortcode before its data feed exists.
      if (isShortcode(loneCode) && BLOCK_CODES.has(loneCode)) {
        const rendered = RENDERERS[loneCode][mode](content, input);
        if (rendered !== '') out.push(rendered); // an empty block (AI off, no at-risk) drops out cleanly
        continue;
      }
      if (!(isShortcode(loneCode) && INLINE_CODES.has(loneCode))) {
        continue; // unknown lone token → render nothing
      }
      // known inline lone token → fall through to inline substitution
    }
    if (trimmed === '') {
      if (mode === 'text') out.push(''); // preserve paragraph spacing in plain text
      continue;
    }
    const substituted = substituteInline(rawLine, content, input, mode);
    out.push(mode === 'html' ? p(substituted) : substituted);
  }
  return mode === 'html' ? out.join('') : out.join('\n');
}

/** Render the daily-sync digest email for one recipient (body from the editable template + fixed shell). */
export function renderDailySyncEmail(input: DailySyncEmailInput): RenderedEmail {
  const { content } = input;
  const subject = `Daily Sync — ${input.syncDateLabel}`;
  const html = renderEmailLayout({
    title: 'Daily Sync',
    preheader: `${content.todayMeetings.length} meeting(s) today · ${content.briefs.length} brief(s)`,
    bodyHtml: renderDailySyncBody(input.template ?? '', content, input, 'html'),
    footnote: 'Internal briefing — Grace & Associates only. Do not forward outside the firm.',
  });
  // Plain-text alternative: title line + rendered body + the confidentiality footnote
  // (parity with the HTML subject + layout footnote).
  const text = [
    subject,
    '',
    renderDailySyncBody(input.template ?? '', content, input, 'text'),
    '',
    'Internal briefing — Grace & Associates only.',
  ].join('\n');
  return { subject, html, text };
}
