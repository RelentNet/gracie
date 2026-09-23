/**
 * DEMO SEED — Cambridge Building Group white-label sandbox.
 *
 * Replaces the Grace & Associates mock set (`seed.ts`, untouched) with a
 * construction world: CBG staff on their own domain, their clients and active
 * jobs, and meetings/documents/tasks positioned RELATIVE TO A RUN-TIME ANCHOR so
 * the app looks alive on the day it is shown.
 *
 * Run from the repo root with the sandbox env loaded:
 *   ./apps/web/node_modules/.bin/tsx packages/db/seed/demo-cbg.ts
 *
 * The anchor is today unless `DEMO_ANCHOR=YYYY-MM-DD` is set. RE-RUN IT on the
 * morning of the demo: "today's meetings" is computed from the anchor, so a stale
 * seed puts every meeting in the past and empties the dashboard.
 *
 * SAFETY: wipes the content tables, so `assertDemoTarget` (demo-guard.ts) allows only
 * a local Supabase, or a demo server named explicitly in `DEMO_SEED_TARGET`.
 *
 * Deterministic: ids are uuid-v5-ish hashes of stable keys and all variation comes
 * from a seeded PRNG, so re-running produces the same world (no duplicate rows,
 * no shuffling between runs).
 */
import { createHash } from 'node:crypto';

import { putObject } from '../../shared/src/storage/index.js';
import { getServerClient } from '../src/index.js';

import { assertDemoTarget } from './demo-guard.js';

// ---------------------------------------------------------------------------
// Safety + determinism
// ---------------------------------------------------------------------------

assertDemoTarget();

function uuid(key: string): string {
  const h = createHash('sha1').update('cbg-demo:' + key).digest('hex');
  return (
    h.slice(0, 8) +
    '-' +
    h.slice(8, 12) +
    '-5' +
    h.slice(13, 16) +
    '-' +
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) +
    h.slice(17, 20) +
    '-' +
    h.slice(20, 32)
  );
}

/** Deterministic PRNG so re-runs produce an identical world. */
function rng(seed: string): () => number {
  let s = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = rng('cbg');
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

// ---------------------------------------------------------------------------
// Time anchor — everything is positioned relative to the demo day
// ---------------------------------------------------------------------------

const anchorRaw = process.env.DEMO_ANCHOR;
const anchor = anchorRaw !== undefined && anchorRaw !== '' ? new Date(`${anchorRaw}T12:00:00Z`) : new Date();
/** Local midnight of the demo day. */
const day0 = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());

/** A timestamp `days` from the demo day at `hour`:`minute` local time. */
function at(days: number, hour: number, minute = 0): Date {
  const d = new Date(day0);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}
const iso = (d: Date): string => d.toISOString();
/** YYYY-MM-DD for `date` columns. */
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const DOMAIN = 'cambridgebg.com';

interface Person {
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly role: 'admin' | 'standard' | 'viewer';
}

const STAFF: readonly Person[] = [
  { key: 'terry', name: 'Terry Gilley', title: 'Founder & President', role: 'admin' },
  { key: 'jason', name: 'Jason Hall', title: 'Executive Vice President', role: 'admin' },
  { key: 'marcus', name: 'Marcus Webb', title: 'Senior Project Manager', role: 'standard' },
  { key: 'dana', name: 'Dana Ruiz', title: 'Project Manager', role: 'standard' },
  { key: 'curtis', name: 'Curtis Vaughn', title: 'Superintendent', role: 'standard' },
  { key: 'alicia', name: 'Alicia Brandt', title: 'Project Engineer', role: 'standard' },
  { key: 'ray', name: 'Ray Mitchell', title: 'Estimator', role: 'standard' },
  { key: 'nora', name: 'Nora Caldwell', title: 'Office Manager', role: 'viewer' },
];

const email = (p: Person): string =>
  `${p.name.split(' ')[0]![0]!.toLowerCase()}${p.name.split(' ')[1]!.toLowerCase()}@${DOMAIN}`;
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

// ---------------------------------------------------------------------------
// Clients (owners, developers, institutions) + their active job
// ---------------------------------------------------------------------------

interface ClientSpec {
  readonly key: string;
  readonly name: string;
  readonly job: string;
  readonly type: 'client' | 'partner' | 'internal' | 'past_client' | 'prospect';
  readonly cadence: 'weekly' | 'biweekly' | 'monthly' | 'qbr' | 'ad_hoc';
  readonly tier: 'low' | 'mid' | 'high';
  /** Invented figure — no real CBG financials are used anywhere in this seed. */
  readonly value: number;
  readonly health: number;
  readonly trend: 'improving' | 'stable' | 'declining';
  readonly contact: string;
  readonly contactEmail: string;
}

const CLIENTS: readonly ClientSpec[] = [
  { key: 'shores', name: 'Nashville Shores', job: 'Waterpark expansion — two slide towers, phase 2', type: 'client', cadence: 'weekly', tier: 'high', value: 8_400_000, health: 88, trend: 'improving', contact: 'Ellen Pruitt', contactEmail: 'epruitt@nashvilleshores.com' },
  { key: 'harpeth', name: 'Harpeth Medical Partners', job: 'Medical office building — 46,000 sf, Brentwood', type: 'client', cadence: 'weekly', tier: 'high', value: 12_900_000, health: 74, trend: 'stable', contact: 'Dr. Ravi Anand', contactEmail: 'randand@harpethmedical.com' },
  { key: 'germantown', name: 'Germantown Row Developers', job: 'Mid-rise multi-family — 180 units', type: 'client', cadence: 'biweekly', tier: 'high', value: 24_500_000, health: 61, trend: 'declining', contact: 'Sloane Carver', contactEmail: 'scarver@germantownrow.com' },
  { key: 'cumberland', name: 'Cumberland Logistics Park', job: 'PEMB distribution facility — 210,000 sf', type: 'client', cadence: 'weekly', tier: 'high', value: 17_200_000, health: 92, trend: 'improving', contact: 'Doug Feltner', contactEmail: 'dfeltner@cumberlandlogistics.com' },
  { key: 'franklin', name: 'Franklin Hospitality Group', job: 'Hotel renovation — 142 keys, full refresh', type: 'client', cadence: 'biweekly', tier: 'mid', value: 6_100_000, health: 70, trend: 'stable', contact: 'Maria Bellamy', contactEmail: 'mbellamy@franklinhg.com' },
  { key: 'metro', name: 'Metro Nashville Public Works', job: 'Maintenance facility replacement', type: 'client', cadence: 'monthly', tier: 'mid', value: 9_300_000, health: 66, trend: 'stable', contact: 'Andre Whitlock', contactEmail: 'andre.whitlock@nashville.gov' },
  { key: 'brentwood', name: 'Brentwood Commons Retail', job: 'Retail center shell + three fit-outs', type: 'client', cadence: 'biweekly', tier: 'mid', value: 4_800_000, health: 79, trend: 'stable', contact: 'Kelsey Nunn', contactEmail: 'knunn@brentwoodcommons.com' },
  { key: 'musicrow', name: 'Music Row Data Center', job: 'Data hall fit-out — phase 1', type: 'client', cadence: 'weekly', tier: 'high', value: 31_000_000, health: 83, trend: 'improving', contact: 'Priya Raman', contactEmail: 'praman@musicrowdc.com' },
  { key: 'rutherford', name: 'Rutherford County Schools', job: 'Gymnasium addition — Blackman campus', type: 'client', cadence: 'monthly', tier: 'mid', value: 5_600_000, health: 72, trend: 'stable', contact: 'Ben Ocasio', contactEmail: 'bocasio@rcschools.net' },
  { key: 'hillsboro', name: 'Hillsboro Village Mixed-Use', job: 'Mixed-use — retail podium, 64 residences', type: 'client', cadence: 'biweekly', tier: 'high', value: 19_700_000, health: 58, trend: 'declining', contact: 'Trent Mabry', contactEmail: 'tmabry@hillsborovillage.dev' },
  { key: 'recover', name: 'Recover Nashville', job: 'Tornado rebuild program — 14 homes', type: 'client', cadence: 'monthly', tier: 'low', value: 1_250_000, health: 95, trend: 'stable', contact: 'Gayle Bratton', contactEmail: 'gbratton@recovernashville.org' },
  { key: 'capsteel', name: 'Capital Steel', job: 'PEMB supply partner', type: 'partner', cadence: 'ad_hoc', tier: 'low', value: 0, health: 90, trend: 'stable', contact: 'Owen Slate', contactEmail: 'oslate@capitalsteel.com' },
  { key: 'kirby', name: 'Kirby Building Systems', job: 'PEMB manufacturer partner', type: 'partner', cadence: 'ad_hoc', tier: 'low', value: 0, health: 86, trend: 'stable', contact: 'Deb Hargrove', contactEmail: 'dhargrove@kirbybuildings.com' },
  { key: 'cbg', name: 'Cambridge Building Group', job: 'Internal', type: 'internal', cadence: 'weekly', tier: 'low', value: 0, health: 90, trend: 'stable', contact: 'Terry Gilley', contactEmail: `tgilley@${DOMAIN}` },
];

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
// Meeting shapes
// ---------------------------------------------------------------------------

const MEETING_KINDS = [
  { label: 'OAC meeting', type: 'weekly_sync' },
  { label: 'Subcontractor coordination', type: 'weekly_sync' },
  { label: 'Owner walkthrough', type: 'technical_review' },
  { label: 'Change order review', type: 'ad_hoc' },
  { label: 'Preconstruction kickoff', type: 'kickoff' },
  { label: 'Safety stand-down review', type: 'ad_hoc' },
  { label: 'Schedule recovery workshop', type: 'technical_review' },
  { label: 'Monthly pay application review', type: 'monthly_review' },
  { label: 'Submittal and RFI review', type: 'technical_review' },
  { label: 'Bid package review', type: 'ad_hoc' },
] as const;

// ---------------------------------------------------------------------------
// Document content
// ---------------------------------------------------------------------------

const DOC_SET = [
  { type: 'post_meeting_analysis', file: 'post_meeting_analysis.md', review: false },
  { type: 'internal_memo', file: 'internal_memo.md', review: false },
  { type: 'client_summary', file: 'client_summary.md', review: true },
  { type: 'task_checklist', file: 'task_checklist.md', review: false },
  { type: 'internal_email_draft', file: 'internal_email.md', review: false },
  { type: 'client_email_draft', file: 'client_email.md', review: true },
] as const;

interface DocContext {
  readonly client: ClientSpec;
  readonly kind: string;
  readonly when: Date;
  readonly lead: Person;
  readonly items: readonly string[];
}

// Paragraphs that differ per meeting. Retrieval surfaces several records side by
// side, and the chat model reliably flags identical wording across them as templated
// ("the identical phrasing may reflect boilerplate"). So every paragraph is chosen per
// MEETING from a pool keyed by the client's trend, and transcripts carry the same
// tone the analysis describes — otherwise the model points out the contradiction.
const lc = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);

/** Deterministic per-meeting pick, so re-seeding reproduces the same text. */
function vary<T>(c: DocContext, salt: string, xs: readonly T[]): T {
  const h = createHash('sha1').update(`${salt}|${c.client.key}|${c.kind}|${c.when.toISOString()}`).digest();
  return xs[h[0]! % xs.length]!;
}

function riskParagraph(c: DocContext): string {
  const item = c.items[0] === undefined ? 'the open submittals' : lc(c.items[0]);
  const pools = {
    declining: [
      `The date is under real pressure. The item most likely to move substantial completion is: ${item}. The owner wants an answer before the next meeting and we should treat that as a hard deadline.`,
      `We lost about four days of float since the last meeting. Recovering it depends on one thing: ${item}.`,
      `Two trades are now stacked in the same week. If ${item} slips again the sequence breaks and we are into recovery overtime.`,
    ],
    improving: [
      `Schedule is holding with float to spare. The only item with any bearing on the critical path is: ${item}.`,
      `Ahead of the baseline by roughly a week. Keep it that way by closing out ${item} before it turns into a constraint.`,
      `No schedule concerns raised. The one thing worth watching is ${item}, and it has a clear owner.`,
    ],
    stable: [
      `Nothing discussed moves the completion date yet. Watch one item: ${item}. If that slips past next week it starts eating float.`,
      `On schedule, with no margin to give back. ${item.charAt(0).toUpperCase() + item.slice(1)} is the item that decides whether that holds.`,
      `The look-ahead is realistic. The dependency to protect is ${item}.`,
    ],
  } as const;
  return vary(c, 'risk', pools[c.client.trend]);
}

function relationshipParagraph(c: DocContext): string {
  const who = c.client.contact;
  const pools = {
    declining: [
      `${who} pushed on the change-order total twice and asked for a cost-to-complete by Friday. Get ahead of that conversation before it becomes a dispute.`,
      `${who} was noticeably shorter with the team than last time and wanted to know why the budget number had moved. Bring the backup, not just the total.`,
      `${who} asked directly whether the schedule is still real. Answer that with the recovery plan in hand at the next meeting.`,
    ],
    improving: [
      `${who} is engaged and making decisions in the room. This is the strongest the relationship has been.`,
      `${who} complimented the field team on site cleanliness and signed off two items on the spot.`,
      `Good meeting. ${who} is starting to talk about the next phase, which is the signal we want.`,
    ],
    stable: [
      `Steady. ${who} wants fewer emails and more decisions made live, so bring options rather than questions.`,
      `${who} was businesslike and quick. No friction, no enthusiasm — keep delivering and it stays that way.`,
      `${who} raised nothing new. The relationship is fine; the risk is complacency on our side.`,
    ],
  } as const;
  return vary(c, 'rel', pools[c.client.trend]);
}

function teamNote(c: DocContext): string {
  const last = c.items[c.items.length - 1];
  const item = last === undefined ? 'the look-ahead' : lc(last);
  return vary(c, 'team', [
    `${c.lead.name} owns the follow-up on: ${item}. Raise it in the Monday coordination call if it is not closed by then.`,
    `Action for the field: ${item}. ${c.lead.name} to confirm it is done before the next owner meeting.`,
    `${c.lead.name} to chase ${item} this week and report back in the internal channel.`,
  ]);
}

function emailCloser(c: DocContext): string {
  return vary(c, 'close', [
    'We will have the updated schedule over to you by Friday.',
    'Updated look-ahead to follow early next week.',
    'We will send drawings and the revised schedule together once the open submittal is back.',
  ]);
}

/** Owner lines for the transcript — the same tone the analysis reports. */
function ownerLines(c: DocContext): { opener: string; closer: string } {
  const item = c.items[0] === undefined ? 'the last open item' : lc(c.items[0]);
  switch (c.client.trend) {
    case 'declining':
      return vary(c, 'owner', [
        { opener: `Before we start — why has the change-order total moved again? I need a cost-to-complete by Friday.`, closer: `I'll be honest, we need to have the budget conversation this week.` },
        { opener: `I want to understand whether the schedule is still real, because I'm hearing different things.`, closer: `Send me the recovery plan before next week, please.` },
        { opener: `Where are we on ${item}? That was promised last time.`, closer: `Okay. I need that closed, not another update.` },
      ]);
    case 'improving':
      return vary(c, 'owner', [
        { opener: `First, the site looked great on Tuesday — thank the crew for me.`, closer: `Good meeting. Let's start talking about phase three soon.` },
        { opener: `Happy with where we are. Just walk me through ${item}.`, closer: `Approved, go ahead. Same time next week.` },
        { opener: `No real concerns from our side this week.`, closer: `Great, thanks everyone.` },
      ]);
    default:
      return vary(c, 'owner', [
        { opener: `Before we do — where did we land on ${item}?`, closer: `Nothing else from me. Same time next week.` },
        { opener: `Let's keep this quick, I have a hard stop at the hour.`, closer: `Fine by me. Thanks.` },
        { opener: `Just the look-ahead and the open RFIs today, please.`, closer: `Okay. Same time next week.` },
      ]);
  }
}

function docBody(docType: string, c: DocContext): string {
  const when = c.when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const bullets = c.items.map((i) => `- ${i}`).join('\n');
  switch (docType) {
    case 'post_meeting_analysis':
      return `# Post-meeting analysis — ${c.client.name}\n\n**${c.kind} · ${when} · Lead: ${c.lead.name}**\n\n## What we covered\n\n${c.client.job}. ${c.kind} ran the full hour with the owner group present.\n\n${bullets}\n\n## Where the risk sits\n\n${riskParagraph(c)}\n\n## Read on the relationship\n\n${relationshipParagraph(c)}\n`;
    case 'internal_memo':
      return `# Internal memo — ${c.client.name}\n\n**${when} · prepared for the project team**\n\nFor the field and the office, not for distribution to the owner.\n\n${bullets}\n\n## Follow-up\n\n${teamNote(c)}\n`;
    case 'client_summary':
      return `# Meeting summary — ${c.client.name}\n\n**${c.kind} · ${when}**\n\nThank you for the time today. Here is our record of what was discussed and agreed.\n\n${bullets}\n\n## Next steps\n\nWe will circulate the revised three-week look-ahead by end of week, with the first item above closed or a date attached to it.\n\n— ${c.lead.name}, Cambridge Building Group\n`;
    case 'task_checklist':
      return `# Task checklist — ${c.client.name}\n\n**Extracted from ${c.kind.toLowerCase()}, ${when}**\n\n${c.items.map((i) => `- [ ] ${i}`).join('\n')}\n`;
    case 'internal_email_draft':
      return `**To:** Project team\n**Subject:** ${c.client.name} — ${c.kind.toLowerCase()} recap, ${when}\n\nTeam,\n\nQuick recap from today so everyone is working off the same list.\n\n${bullets}\n\nShout if any of this conflicts with what you heard in the room.\n\n${c.lead.name}\n`;
    case 'client_email_draft':
      return `**To:** ${c.client.contact} <${c.client.contactEmail}>\n**Subject:** ${c.client.name} — recap and next steps\n\n${c.client.contact.split(' ')[0]},\n\nThanks for the time today. Summarising what we agreed so nothing sits in anyone's inbox:\n\n${bullets}\n\n${emailCloser(c)}\n\nBest regards,\n${c.lead.name}\nCambridge Building Group\n`;
    default:
      return `# ${docType}\n\n${bullets}\n`;
  }
}

function transcriptBody(c: DocContext): string {
  const t = (m: number): string => `00:${String(m).padStart(2, '0')}:00`;
  const owner = ownerLines(c);
  const lines = [
    `${t(0)}  ${c.lead.name}: Alright, we're recording. ${c.kind} for ${c.client.name}, let's get through the look-ahead first.`,
    `${t(3)}  ${c.client.contact}: ${owner.opener}`,
    `${t(4)}  ${c.lead.name}: ${c.items[0] ?? 'Still open, we owe you an answer.'}`,
    `${t(9)}  Curtis Vaughn: Field side, we're clear through next Tuesday. After that it depends on the submittal coming back.`,
    `${t(14)}  ${c.client.contact}: Understood. What do you need from us?`,
    `${t(15)}  ${c.lead.name}: ${c.items[1] ?? 'Just the sign-off, and we can keep moving.'}`,
    `${t(24)}  Alicia Brandt: I'll get the RFI log updated and circulated this afternoon.`,
    `${t(31)}  ${c.lead.name}: ${c.items[2] ?? 'Good. Anything else for the good of the order?'}`,
    `${t(38)}  ${c.client.contact}: ${owner.closer}`,
    `${t(39)}  ${c.lead.name}: Same time next week. Thanks everyone.`,
  ];
  return lines.join('\n\n');
}

const ITEM_POOL: readonly string[] = [
  'Confirm steel delivery date with Capital Steel and update the procurement log',
  'Issue RFI response on the canopy connection detail',
  'Price the owner-requested change to the lobby finish package',
  'Resolve the conflict between mechanical routing and the structural beam at grid C',
  'Submit the revised three-week look-ahead to the owner',
  'Close out the open safety observation from the north elevation',
  'Get the updated geotech letter into the permit set',
  'Confirm the inspection window with Metro codes',
  'Reconcile the pay application against stored materials',
  'Return the approved submittal on the storefront glazing',
  'Schedule the pre-installation meeting for roofing',
  'Update the site logistics plan for the crane pick',
  'Chase the electrical subcontractor for their manpower projection',
  'Document the as-built deviation at the loading dock slab',
  'Confirm the owner-furnished equipment delivery dates',
  'Review the punch list walk schedule with the owner',
];

// ---------------------------------------------------------------------------
// Build + write
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function wipe(db: ReturnType<typeof getServerClient>): Promise<void> {
  // Child-first so foreign keys stay satisfied.
  const order = [
    'embeddings',
    'master_record_entries',
    'task_notes',
    'tasks',
    'documents',
    'folders',
    'client_notes',
    'meetings',
    'clients',
    'users',
  ];
  for (const table of order) {
    const { error } = await db.from(table).delete().neq('id', uuid('never-matches'));
    if (error !== null) throw new Error(`wipe ${table}: ${error.message}`);
  }
  console.log('wiped content tables');
}

async function upsert(
  db: ReturnType<typeof getServerClient>,
  table: string,
  rows: readonly Row[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db.from(table) as any).upsert(chunk, { onConflict: 'id' });
    if (error !== null) throw new Error(`upsert ${table}: ${error.message}`);
  }
  console.log(`seeded ${table}: ${rows.length} rows`);
}

async function main(): Promise<void> {
  const db = getServerClient();
  await wipe(db);

  // --- users ---------------------------------------------------------------
  const userId = (p: Person): string => uuid(`user:${p.key}`);
  await upsert(
    db,
    'users',
    STAFF.map((p) => ({
      id: userId(p),
      logto_id: `demo|${p.key}`,
      email: email(p),
      name: p.name,
      initials: initials(p.name),
      role: p.role,
      calendar_connected: p.role !== 'viewer',
      last_active_at: iso(at(0, 8, 15)),
      auto_join_meetings: true,
      timezone: 'America/Chicago',
      created_at: iso(at(-400, 9)),
      updated_at: iso(at(0, 8)),
    })),
  );

  // --- clients -------------------------------------------------------------
  const clientId = (c: ClientSpec): string => uuid(`client:${c.key}`);
  await upsert(
    db,
    'clients',
    CLIENTS.map((c) => ({
      id: clientId(c),
      name: c.name,
      initials: initials(c.name),
      contract_number: c.type === 'client' ? `CBG-${2400 + CLIENTS.indexOf(c)}` : null,
      primary_contact: c.contact,
      primary_contact_email: c.contactEmail,
      cadence: c.cadence,
      fee_tier: c.tier,
      contract_value: c.value === 0 ? null : c.value,
      billing_cadence: c.type === 'client' ? 'monthly' : null,
      description: c.job,
      relationship_health: c.health,
      relationship_trend: c.trend,
      health_updated_at: iso(at(-1, 3)),
      type: c.type,
      created_at: iso(at(-300, 9)),
      updated_at: iso(at(0, 8)),
    })),
  );

  // --- meetings ------------------------------------------------------------
  // Offsets chosen so the demo day itself is busy: two meetings today (one already
  // written up, one still to come), four tomorrow, the rest spread behind and ahead.
  const schedule: { offset: number; hour: number }[] = [
    { offset: 0, hour: 8 },
    { offset: 0, hour: 14 },
    { offset: 1, hour: 9 },
    { offset: 1, hour: 11 },
    { offset: 1, hour: 13 },
    { offset: 1, hour: 15 },
    { offset: 2, hour: 10 },
    { offset: 3, hour: 9 },
    { offset: 4, hour: 14 },
    { offset: 7, hour: 10 },
  ];
  for (let w = 1; w <= 8; w += 1) {
    for (const h of [9, 11, 14]) {
      schedule.push({ offset: -w * 2 - Math.floor(rand() * 3), hour: h });
    }
  }

  const meetings: Row[] = [];
  const completed: { id: string; client: ClientSpec; when: Date; lead: Person; kind: string; items: string[] }[] = [];
  schedule.forEach((slot, i) => {
    const client = CLIENTS[i % 11]!; // the 11 real clients, not the partners/internal
    const kind = MEETING_KINDS[i % MEETING_KINDS.length]!;
    const lead = STAFF[2 + (i % 4)]!; // PMs and supers lead
    const when = at(slot.offset, slot.hour, 0);
    const id = uuid(`meeting:${i}`);
    const past = when.getTime() < anchor.getTime();
    const items = [pick(ITEM_POOL), pick(ITEM_POOL), pick(ITEM_POOL)].filter(
      (v, idx, a) => a.indexOf(v) === idx,
    );
    meetings.push({
      id,
      client_id: clientId(client),
      title: `${client.name} — ${kind.label}`,
      date_time: iso(when),
      duration_minutes: 60,
      meeting_type: kind.type,
      meeting_lead_user_id: userId(lead),
      attendee_user_ids: [userId(lead), userId(STAFF[1]!), userId(STAFF[4]!)],
      calendar_event_id: `demo-evt-${i}`,
      video_link: 'https://teams.microsoft.com/l/meetup-join/demo',
      bot_dispatched: past,
      bot_job_id: past ? `demo-bot-${i}` : null,
      transcript_received: past,
      pipeline_status: past ? 'complete' : 'scheduled',
      pipeline_started_at: past ? iso(new Date(when.getTime() + 60 * 60_000)) : null,
      pipeline_completed_at: past ? iso(new Date(when.getTime() + 64 * 60_000)) : null,
      has_open_items: past,
      source: 'calendar',
      is_internal: false,
      external_attendees: [{ name: client.contact, email: client.contactEmail }],
      created_at: iso(at(-30, 9)),
      updated_at: iso(when),
    });
    if (past) completed.push({ id, client, when, lead, kind: kind.label, items });
  });
  await upsert(db, 'meetings', meetings);

  // --- folders + documents (with real bytes, so previews work) -------------
  const folders: Row[] = [];
  const documents: Row[] = [];
  const uploads: { key: string; body: string; type: string }[] = [];
  const seenFolders = new Set<string>();

  function ensureFolder(client: ClientSpec, path: string, name: string): string {
    const id = uuid(`folder:${path}`);
    if (!seenFolders.has(path)) {
      seenFolders.add(path);
      folders.push({
        id,
        client_id: clientId(client),
        path,
        display_name: name,
        visibility: 'all',
        allowed_roles: ['admin', 'standard', 'viewer'],
        created_at: iso(at(-200, 9)),
        updated_at: iso(at(-200, 9)),
      });
    }
    return id;
  }

  for (const c of CLIENTS) {
    ensureFolder(c, `clients/${slug(c.name)}/generated`, 'Generated Docs');
    ensureFolder(c, `clients/${slug(c.name)}/uploads`, 'Uploads');
  }

  // Full document set for the most recent meetings — enough for any screen the
  // demo opens, without writing thousands of objects.
  const withDocs = completed
    .slice()
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, 16);

  for (const m of withDocs) {
    const base = `clients/${slug(m.client.name)}/generated`;
    const stamp = dateOnly(m.when);
    const folderPath = `${base}/${stamp}-${slug(m.kind)}`;
    const folderId = ensureFolder(m.client, folderPath, `${stamp} · ${m.kind}`);
    const ctx: DocContext = { client: m.client, kind: m.kind, when: m.when, lead: m.lead, items: m.items };

    for (const spec of DOC_SET) {
      const key = `${folderPath}/${spec.file}`;
      const body = docBody(spec.type, ctx);
      uploads.push({ key, body, type: 'text/markdown' });
      documents.push({
        id: uuid(`doc:${key}`),
        meeting_id: m.id,
        client_id: clientId(m.client),
        folder_id: folderId,
        document_type: spec.type,
        source_badge: 'meeting',
        r2_key: key,
        file_name: spec.file,
        file_size: Buffer.byteLength(body, 'utf8'),
        requires_review: spec.review,
        status: spec.review ? 'needs_review' : 'ready',
        created_at: iso(new Date(m.when.getTime() + 64 * 60_000)),
        updated_at: iso(new Date(m.when.getTime() + 64 * 60_000)),
      });
    }
    const tKey = `${folderPath}/transcript.md`;
    const tBody = transcriptBody(ctx);
    uploads.push({ key: tKey, body: tBody, type: 'text/markdown' });
    documents.push({
      id: uuid(`doc:${tKey}`),
      meeting_id: m.id,
      client_id: clientId(m.client),
      folder_id: folderId,
      document_type: 'other',
      source_badge: 'meeting',
      r2_key: tKey,
      file_name: 'transcript.md',
      file_size: Buffer.byteLength(tBody, 'utf8'),
      requires_review: false,
      status: 'ready',
      created_at: iso(new Date(m.when.getTime() + 62 * 60_000)),
      updated_at: iso(new Date(m.when.getTime() + 62 * 60_000)),
    });
  }

  await upsert(db, 'folders', folders);
  await upsert(db, 'documents', documents);

  console.log(`uploading ${uploads.length} objects…`);
  for (const u of uploads) {
    await putObject(u.key, Buffer.from(u.body, 'utf8'), u.type);
  }
  console.log(`uploaded ${uploads.length} objects`);

  // --- tasks ---------------------------------------------------------------
  const tasks: Row[] = [];
  completed.forEach((m, i) => {
    m.items.forEach((item, j) => {
      const n = i * 3 + j;
      const overdue = n % 7 === 0;
      const dueOffset = overdue ? -2 - (n % 5) : (n % 12) - 1;
      tasks.push({
        id: uuid(`task:${m.id}:${j}`),
        client_id: clientId(m.client),
        source_meeting_id: m.id,
        description: item,
        owner_user_id: userId(STAFF[2 + (n % 5)]!),
        due_date: dateOnly(at(dueOffset, 12)),
        status: n % 4 === 0 ? 'complete' : n % 3 === 0 ? 'in_progress' : 'open',
        priority_flag: overdue || n % 9 === 0,
        archived: false,
        created_at: iso(new Date(m.when.getTime() + 65 * 60_000)),
        updated_at: iso(at(-1, 16)),
      });
    });
  });
  await upsert(db, 'tasks', tasks);

  // --- notes + master record ----------------------------------------------
  const notes: Row[] = CLIENTS.filter((c) => c.type === 'client').map((c, i) => ({
    id: uuid(`note:${c.key}`),
    client_id: clientId(c),
    author_user_id: userId(STAFF[1 + (i % 3)]!),
    content:
      c.trend === 'declining'
        ? `Owner is feeling the schedule pressure. ${c.job.split('—')[0]!.trim()} — keep the look-ahead in front of them weekly and get ahead of the change order conversation.`
        : `Relationship is solid. ${c.contact} prefers decisions made in the room rather than over email; keep the cadence as-is.`,
    created_at: iso(at(-14 - i, 10)),
    updated_at: iso(at(-14 - i, 10)),
  }));
  await upsert(db, 'client_notes', notes);

  const master: Row[] = withDocs.map((m) => ({
    id: uuid(`mre:${m.id}`),
    client_id: clientId(m.client),
    meeting_id: m.id,
    summary: `${m.kind}: ${m.items[0] ?? 'covered the look-ahead and open RFIs'}.`,
    created_at: iso(new Date(m.when.getTime() + 66 * 60_000)),
  }));
  await upsert(db, 'master_record_entries', master);

  // Keep the list page's "last met" column honest.
  for (const c of CLIENTS) {
    const last = completed
      .filter((m) => m.client.key === c.key)
      .sort((a, b) => b.when.getTime() - a.when.getTime())[0];
    if (last !== undefined) {
      await db.from('clients').update({ last_meeting_at: iso(last.when) }).eq('id', clientId(c));
    }
  }

  console.log(`\nDEMO SEED COMPLETE — anchor ${dateOnly(day0)}`);
  console.log(`  ${STAFF.length} staff · ${CLIENTS.length} clients · ${meetings.length} meetings`);
  console.log(`  ${documents.length} documents · ${tasks.length} tasks`);
  console.log('  Re-run on the morning of the demo so "today" is really today.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
