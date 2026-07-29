/**
 * Editable daily-sync template rendering (DS). Guards the pure shortcode renderer +
 * the AI-brief source builder — no DB, no LLM.
 *
 * Invariants:
 *   - the DEFAULT template reproduces today's sections, in order (byte-for-byte
 *     behaviour is unchanged when nothing is configured),
 *   - a lone block shortcode expands; unknown tokens render literally; a blank
 *     template falls back to the default; `{ai_brief}` with no narrative vanishes,
 *   - inline `{recipient_name}`/`{sync_date}` substitute inside text lines,
 *   - the AI source contains ONLY the provided facts (grounding) and the default
 *     prompt carries the "only provided info" rule.
 *
 * Pure — run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_AI_BRIEF_PROMPT, DEFAULT_DAILY_SYNC_TEMPLATE, type DailySyncContent } from '@gracie/shared';

import { buildAiBriefSource } from './daily-sync-ai.js';
import { renderDailySyncBody, renderDailySyncEmail, type DailySyncEmailInput } from './email-templates/daily-sync.js';
import { escapeHtml } from './email-templates/layout.js';

const CONTENT: DailySyncContent = {
  version: 1,
  generatedAtIso: '2026-07-10T10:00:00Z',
  yesterday: { meetingsProcessed: 2, documentsGenerated: 5, tasksCreated: 3, tasksCompleted: 1 },
  todayMeetings: [
    {
      meetingId: 'm1',
      title: 'Kickoff',
      timeIso: '2026-07-10T14:00:00Z',
      clientId: 'c1',
      clientName: 'Acme',
      isInternal: false,
      leadName: 'Allie',
      hasBrief: true,
    },
  ],
  tomorrowMeetings: [
    {
      meetingId: 'm2',
      title: 'Roadmap review',
      timeIso: '2026-07-11T15:00:00Z',
      clientId: 'c1',
      clientName: 'Acme',
      isInternal: false,
      leadName: 'Sam',
      hasBrief: false,
    },
  ],
  atRiskClients: [{ clientId: 'c2', name: 'Beta Corp', health: 41, trend: 'declining' }],
  briefs: [{ meetingId: 'm1', title: 'Kickoff', clientName: 'Acme', clientId: 'c1', content: 'Client: Acme\nOpen items:\n- Send SOW' }],
  lastWeekTodos: [{ description: 'Follow up on SOW', clientName: 'Acme', dueDate: '2026-07-12', priority: true }],
  aiBrief: null,
};

const INPUT: DailySyncEmailInput = {
  recipientName: 'Allie Grace',
  syncDateLabel: 'Friday, July 10, 2026',
  content: CONTENT,
  appUrl: 'https://app.example.com',
};

test('default template reproduces today’s sections, in order', () => {
  const html = renderDailySyncBody(DEFAULT_DAILY_SYNC_TEMPLATE, CONTENT, INPUT, 'html');
  // Greeting + each heading present, in the historical order (headings are HTML-escaped).
  const order = [
    'Good morning, Allie Grace.',
    escapeHtml('Yesterday'),
    escapeHtml("Today's meetings"),
    escapeHtml('Clients to watch'),
    escapeHtml('Pre-meeting briefs'),
  ];
  let last = -1;
  for (const needle of order) {
    const at = html.indexOf(needle);
    assert.ok(at > last, `"${needle}" must appear after the previous section`);
    last = at;
  }
  // The default template does NOT introduce the new sections (unchanged behaviour).
  assert.ok(!html.includes(escapeHtml("Last week's open to-dos")), 'default must not add the last-week section');
  assert.ok(!html.includes(escapeHtml("Gracie's briefing")), 'default must not add the AI section');
  // The CTA button is present.
  assert.ok(html.includes('Open Daily Sync'));
});

test('lone block shortcode expands; unknown token renders EMPTY (not literal); inline tokens substitute', () => {
  const tmpl = ['Hello {recipient_name} on {sync_date}.', '{last_week_todos}', '{not_a_real_code}'].join('\n');
  const html = renderDailySyncBody(tmpl, CONTENT, INPUT, 'html');
  assert.ok(html.includes('Hello Allie Grace on Friday, July 10, 2026.'), 'inline substitution');
  assert.ok(html.includes(escapeHtml("Last week's open to-dos")), 'block expands');
  assert.ok(html.includes('Follow up on SOW'), 'todo rendered');
  // v2: a lone unknown/not-yet-built token renders empty so a template can safely
  // reference a shortcode before its data feed exists.
  assert.ok(!html.includes('not_a_real_code'), 'unknown lone token renders empty, never a literal {token}');
});

test('{tomorrows_meetings} renders the next-day schedule (item 1)', () => {
  const html = renderDailySyncBody('{tomorrows_meetings}', CONTENT, INPUT, 'html');
  assert.ok(html.includes(escapeHtml("Tomorrow's meetings")), 'heading present');
  assert.ok(html.includes('Roadmap review'), 'tomorrow meeting listed');
  // Absent tomorrowMeetings → a clean "no meetings" note, never a crash.
  const empty = renderDailySyncBody('{tomorrows_meetings}', { ...CONTENT, tomorrowMeetings: undefined }, INPUT, 'html');
  assert.ok(empty.includes('No meetings scheduled tomorrow.'));
});

test('pre-meeting brief cards end with a link cluster (item 2)', () => {
  const html = renderDailySyncBody('{pre_meeting_briefs}', CONTENT, INPUT, 'html');
  assert.ok(html.includes('https://app.example.com/meetings/m1'), 'meeting-occurrence link');
  assert.ok(html.includes('https://app.example.com/clients/c1'), 'client-page link');
  assert.ok(html.includes('Client page'), 'client-page label');
  const text = renderDailySyncBody('{pre_meeting_briefs}', CONTENT, INPUT, 'text');
  assert.ok(text.includes('https://app.example.com/meetings/m1'), 'plain-text meeting link');
});

test('{team_out} renders empty (no OOO feed ingested yet — item 4)', () => {
  const html = renderDailySyncBody('Intro.\n{team_out}\nOutro.', CONTENT, INPUT, 'html');
  assert.ok(!html.toLowerCase().includes('out today'), 'no team-out header');
  assert.ok(!html.includes('{team_out}'), 'never a literal token');
});

test('{at_risk_clients} with no at-risk clients renders NOTHING, not zeros (item 5)', () => {
  const none: DailySyncContent = { ...CONTENT, atRiskClients: [] };
  const html = renderDailySyncBody('{at_risk_clients}', none, { ...INPUT, content: none }, 'html');
  assert.equal(html, '', 'empty at-risk → no header, no "(none)"');
  const text = renderDailySyncBody('{at_risk_clients}', none, { ...INPUT, content: none }, 'text');
  assert.equal(text, '', 'empty at-risk (text) → nothing');
  // Non-empty still renders the section.
  const some = renderDailySyncBody('{at_risk_clients}', CONTENT, INPUT, 'html');
  assert.ok(some.includes(escapeHtml('Clients to watch')) && some.includes('Beta Corp'));
});

test('inline shortcode is escaped exactly once (no double-escape of names)', () => {
  const html = renderDailySyncBody('Good morning, {recipient_name}.', CONTENT, { ...INPUT, recipientName: "O'Brien & Co" }, 'html');
  assert.ok(html.includes('Good morning, O&#39;Brien &amp; Co.'), 'single-escaped');
  assert.ok(!html.includes('&amp;#39;'), 'must NOT be double-escaped');
});

test('blank template falls back to the default (never a blank email)', () => {
  const blank = renderDailySyncBody('   \n  ', CONTENT, INPUT, 'html');
  const dflt = renderDailySyncBody(DEFAULT_DAILY_SYNC_TEMPLATE, CONTENT, INPUT, 'html');
  assert.equal(blank, dflt);
});

test('{ai_brief} renders empty when no narrative, and the box when present', () => {
  const tmpl = 'Intro.\n{ai_brief}\nOutro.';
  const off = renderDailySyncBody(tmpl, CONTENT, INPUT, 'html');
  assert.ok(!off.includes(escapeHtml("Gracie's briefing")), 'no AI section when aiBrief is null');

  const withAi: DailySyncContent = { ...CONTENT, aiBrief: 'Today is busy. [VERIFY: two client calls]' };
  const on = renderDailySyncBody(tmpl, withAi, { ...INPUT, content: withAi }, 'html');
  assert.ok(on.includes(escapeHtml("Gracie's briefing")), 'AI section shows when present');
  assert.ok(on.includes('Today is busy.'));
});

test('renderDailySyncEmail wraps the body in the fixed shell', () => {
  const email = renderDailySyncEmail({ ...INPUT, template: DEFAULT_DAILY_SYNC_TEMPLATE });
  assert.equal(email.subject, 'Daily Sync — Friday, July 10, 2026');
  assert.ok(email.html.includes('<!doctype html>'), 'fixed shell present');
  assert.ok(email.html.includes('Grace &amp; Associates'), 'locked chrome present');
  assert.ok(email.text.includes('Yesterday:'), 'plain-text alternative rendered');
});

test('AI source contains ONLY provided facts; default prompt carries the grounding rule', () => {
  const source = buildAiBriefSource(CONTENT, INPUT.syncDateLabel);
  // Every fact the model may use comes from CONTENT.
  assert.ok(source.includes('Friday, July 10, 2026'));
  assert.ok(source.includes('Kickoff'));
  assert.ok(source.includes('Roadmap review'), "tomorrow's meetings feed the AI context (item 1)");
  assert.ok(source.includes('Beta Corp'));
  assert.ok(source.includes('Follow up on SOW'));
  // It must NOT carry the greeting/recipient or the CTA button (those aren't facts).
  assert.ok(!source.includes('Allie Grace'), 'no recipient identity in the model source');
  assert.ok(!source.includes('Open Daily Sync'), 'no CTA button in the model source');
  // The default prompt hard-codes the grounding rule.
  assert.match(DEFAULT_AI_BRIEF_PROMPT, /ONLY the/);
  assert.match(DEFAULT_AI_BRIEF_PROMPT, /never invent/i);
});
