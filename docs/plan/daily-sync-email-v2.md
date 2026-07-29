# Delegation Brief — Daily Sync Email v2 (Allie's design spec)

> Self-contained brief. Web `apps/web`, worker `apps/worker`, shared `packages/shared`. Branch + PR, do NOT push to main.
> Builds on the shipped editable daily-sync template (#61). Source: design spec prepared by Allie Grace, 2026-07-28.

## Scope for THIS session
BUILD: build-list items 1–4 below, plus the item-5 empty-render fix. DEFER items 6–7 (marked "later" by Allie).
NOT A BUILD (do not hardcode): §2 template and §3 AI prompt are runtime config the operator pastes into the Settings boxes #61 already shipped. Do NOT change the shipped code defaults to these. Just make sure every shortcode the template references renders correctly, and that UNKNOWN/not-yet-built shortcodes render as EMPTY (never as literal `{token}` text) so a template can safely reference a shortcode before its data exists.
HONESTY RULE: items 3 (agenda flag) and 4 (team_out) depend on data that may not be ingested yet (a meeting agenda/body field; calendar OOO/out-of-office events). Before building each, VERIFY the data source exists (check the calendar-scan processor + the `meetings` schema + MS Graph fields already fetched). If the data is present, build it. If it is NOT, implement the shortcode to render empty + clearly FLAG in the PR what data feed is missing and what it would take — do NOT fabricate a value or invent a field. Never invent data; that violates the whole "deterministic, trusted" premise.

## 1. Design principles
One page, links out — the email is a cockpit, not a report; every section links to the deeper artifact in Gracie. Deterministic first, AI second. Two jobs: (1) nobody walks into a client meeting cold, (2) nothing we committed to a client slips. Excluded for now: health scores / at-risk flags (not calibrated), and yesterday's stat cards at the top (moved to footer).

## 2. Email template (PASTE-IN config — recommended default for the operator to paste, NOT a code change)
```
Good morning, {recipient_name}.

{todays_meetings}

{ai_brief}

{pre_meeting_briefs}

{last_week_todos}

{yesterday_activity}

{open_daily_sync_button}
```
Order rationale: schedule first, then AI narrative, then per-meeting brief cards w/ links, then open tasks, then yesterday's rollup as footer.

## 3. AI prompt (PASTE-IN config — NOT a code change)
```
You are Gracie, the internal operations agent for the Grace & Associates consulting team. Each morning you write the briefing that opens the Daily Sync. Your job is singular: make sure no one walks into a client meeting cold, and nothing we owe a client slips.

You will be given: today's meetings, tomorrow's meetings, the most recent meeting summaries for each client on those calendars, and open to-dos from the last 7 days.

Work ONLY from that data. Do NOT add outside knowledge. Never invent names, numbers, dates, dollar figures, or commitments. If something is implied but not confirmed in the data, wrap it in [VERIFY: ...]. If there is no history on file for a meeting, write "No prior meeting on file" and stop; do not fill the gap.

LENGTH AND TONE
- Hard cap: 450 words. Readable in under 3 minutes.
- Internal audience: candid, practical, zero pleasantries, zero filler. "No agenda on file" is a finding, not an insult.
- Short Markdown headings and tight bullets. Bold every client name, date, dollar figure, and deadline.
- Do not restate the calendar or the task list; the email already contains both. Your job is prioritization and connection, not repetition.

STRUCTURE (use exactly these sections, omit any that are empty)
THE DAY IN ONE LINE. One sentence: the shape of the day and the single most important thing to get right.
MEETING PREP. For each external or client meeting today, in calendar order, 2-4 bullets maximum: Where we left it (decisions/outcomes from most recent meeting(s), with dates); We owe them / they owe us (open commitments, responsible person named); Today's objective (only if stated/implied); Flag (anything unresolved, overdue, sensitive, contradictory). Skip internal meetings unless a decision item is attached.
CARRIED OVER. Open to-dos from last 7 days. Order: items touching today's/tomorrow's clients first, then overdue, then no-owner (call out UNOWNED). Name the owner on every item. Max 6 bullets; if more, add "Plus N more in the Daily Sync page."
TOMORROW'S FIRST LOOK. Only if tomorrow's meetings are in the data: one line per meeting naming what must happen TODAY to be ready. If tomorrow's data absent, omit.
WATCH. Max 3 bullets, only from data: schedule collisions, meetings with no agenda/no lead on file, client concern/friction in recent notes. Omit if none.
RULES: Every claim traces to provided data. Attribute each commitment to who made it. Prefer "who does what by when." When meetings connect (same client/partner/opportunity in more than one), say so in one line.
```

## 4. Build list (THIS session builds 1–5, defers 6–7)
1. **`{tomorrows_meetings}` shortcode + data feed + AI context.** Register the shortcode in the shared registry. Worker renders it by reusing the `{todays_meetings}` logic over the next-day window (America/New_York). Pass tomorrow's meetings into the AI compose grounding data (`daily-sync-ai.ts`) so the prompt's "Tomorrow's first look" section has data. Add to the web Settings shortcode reference list. HIGHEST VALUE.
2. **Link cluster on every pre-meeting brief card.** Each `{pre_meeting_briefs}` card ends with one line: `Summary | Last meeting notes | Transcript | Client page`, absolute URLs into Gracie (reuse the app base URL that `{open_daily_sync_button}` already uses). Link targets: the client page (exists) and the meeting-occurrence detail route `/meetings/[id]` (a parallel session is building that page — link to the path as the contract, do not build the page); link Summary/Notes/Transcript to the best available target (the meeting page and/or the relevant document). If a specific document deep-link isn't available, link to the meeting page.
3. **Meeting metadata: agenda yes/no flag.** `{todays_meetings}` (and `{tomorrows_meetings}`) already show the lead — add an "Agenda: yes/no" flag per meeting IF an agenda/body field is available (see HONESTY RULE). The AI Watch section (prompt-side, already covered) surfaces gaps/collisions.
4. **`{team_out}` shortcode.** One line: who is out/traveling today, from calendar OOO entries (MS Graph out-of-office). Register + render + add to Settings reference. Subject to the HONESTY RULE (verify OOO events are ingested first).
5. **`{at_risk_clients}` empty → render NOTHING, not zeros.** When there are no at-risk clients, the shortcode renders as empty (no header, no "health 0" rows). Keep the feature toggle default OFF. Small renderer fix.
6. **Recipient-aware ordering (LATER — defer).** Each recipient's own carried-over items sort to the top of their copy.
7. **Monday edition (LATER — defer).** On Mondays, append a week-at-a-glance strip: one line per day, client names only.

## 5. What good looks like
A team member who missed yesterday can read the email in 3 minutes at 6:15 AM and know: (a) their day, (b) what each client expects of us, (c) what they personally owe, (d) what must be fixed before tomorrow. Anything not serving one of those four goes behind a link on the Daily Sync page, not in the email.
