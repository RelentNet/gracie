/**
 * The 6 AM daily-sync digest email (P7 §6). One email per active staffer bundling
 * yesterday's activity, today's schedule, at-risk clients, and that day's
 * pre-meeting briefs (§7). Internal/team only — delivery is allowlist-gated by
 * `sendEmail`. Content is deterministic (no AI dependency) for cron reliability.
 */
import type { DailySyncContent } from '@gracie/shared';

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
}

/** A short meeting line: "9:00 AM — Title (Client) · Internal". */
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

/** Render the daily-sync digest email for one recipient. */
export function renderDailySyncEmail(input: DailySyncEmailInput): RenderedEmail {
  const { content } = input;
  const subject = `Daily Sync — ${input.syncDateLabel}`;

  const y = content.yesterday;
  const hadYesterday =
    y.meetingsProcessed + y.documentsGenerated + y.tasksCreated + y.tasksCompleted > 0;

  const sections: string[] = [];
  sections.push(p(`Good morning, ${input.recipientName}.`));

  sections.push(h2('Yesterday'));
  sections.push(
    hadYesterday
      ? statRow([
          { label: 'Meetings processed', value: y.meetingsProcessed },
          { label: 'Documents', value: y.documentsGenerated },
          { label: 'Tasks created', value: y.tasksCreated },
          { label: 'Tasks completed', value: y.tasksCompleted },
        ])
      : muted('No recorded activity yesterday.'),
  );

  sections.push(h2("Today's meetings"));
  sections.push(
    content.todayMeetings.length > 0
      ? ul(content.todayMeetings.map(meetingLine))
      : muted('No meetings scheduled today.'),
  );

  sections.push(h2('Clients to watch'));
  sections.push(
    content.atRiskClients.length > 0
      ? ul(content.atRiskClients.map(atRiskLine))
      : muted('No at-risk clients right now.'),
  );

  sections.push(h2('Pre-meeting briefs'));
  if (content.briefs.length > 0) {
    for (const brief of content.briefs) {
      const heading =
        `<div style="font-size:14px;font-weight:700;color:#10233f;margin:0 0 6px;">` +
        `${escapeHtml(brief.title)}${brief.clientName !== null ? ` · ${escapeHtml(brief.clientName)}` : ''}</div>`;
      sections.push(box(heading + preText(brief.content)));
    }
  } else {
    sections.push(muted('No briefs for today’s meetings.'));
  }

  sections.push(button('Open Daily Sync', `${input.appUrl}/daily-sync`));

  const html = renderEmailLayout({
    title: 'Daily Sync',
    preheader: `${content.todayMeetings.length} meeting(s) today · ${content.briefs.length} brief(s)`,
    bodyHtml: sections.join(''),
    footnote: 'Internal briefing — Grace & Associates only. Do not forward outside the firm.',
  });

  return { subject, html, text: buildDailySyncText(input) };
}

/** Plain-text alternative (deliverability + accessibility). */
function buildDailySyncText(input: DailySyncEmailInput): string {
  const { content } = input;
  const y = content.yesterday;
  const lines: string[] = [
    `Daily Sync — ${input.syncDateLabel}`,
    '',
    `Good morning, ${input.recipientName}.`,
    '',
    'Yesterday:',
    `  Meetings processed: ${y.meetingsProcessed}`,
    `  Documents generated: ${y.documentsGenerated}`,
    `  Tasks created: ${y.tasksCreated}`,
    `  Tasks completed: ${y.tasksCompleted}`,
    '',
    "Today's meetings:",
    ...(content.todayMeetings.length > 0
      ? content.todayMeetings.map((m) => `  - ${meetingLine(m)}`)
      : ['  (none)']),
    '',
    'Clients to watch:',
    ...(content.atRiskClients.length > 0
      ? content.atRiskClients.map((c) => `  - ${atRiskLine(c)}`)
      : ['  (none)']),
    '',
    'Pre-meeting briefs:',
    ...(content.briefs.length > 0
      ? content.briefs.flatMap((b) => [
          `  # ${b.title}${b.clientName !== null ? ` · ${b.clientName}` : ''}`,
          ...b.content.split('\n').map((l) => `    ${l}`),
          '',
        ])
      : ['  (none)']),
    '',
    `Open Daily Sync: ${input.appUrl}/daily-sync`,
    '',
    'Internal briefing — Grace & Associates only.',
  ];
  return lines.join('\n');
}
