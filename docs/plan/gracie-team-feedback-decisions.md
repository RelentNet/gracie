# Gracie — Team Feedback: decisions record

Decisions on `Gracie_Team_Feedback_Checklist.md.pdf` (GA Daily Sync feedback), reconciled with the **Daniel↔Allie walkthrough call** transcript and Daniel's follow-up calls. Tags: **[SETTLED]** · **[OPERATOR]** override · **[OPEN]** needs a call.

## Video & recording
1. **Click transcript line → jump video** (built #78/#80) → **[SETTLED] Done, demo as-is.**
2. **Screen-share STILLS** (Chris/Richard's real ask) → **[SETTLED]** Make Recall capture screen share, then auto-grab a still on each slide/screen change (~4–5/meeting, kilobytes). Keep stills **indefinitely**, pinned to the transcript timestamp. After video expires, stills remain as the visual record.
3. **Transcripts kept indefinitely** → **[SETTLED]** readable doc (done, #80) + the timestamped transcript (already stored) as the rail stills pin onto.
4. **Video retention** → **[OPERATOR] 6 months, rolling** (~$30/mo; easy to shorten, can't recover deletions). Set Recall retention ≈180 days.
5. **Retention not tied to activity reports** → **[SETTLED]** general window; reports use transcript/stills/data.
6. **Screen shares aren't recorded today** → **[SETTLED]** make Recall capture them (precondition for #2).

## Tasks — ⚠️ major redesign of the shipped board (#88)
7. **Board becomes HIDDEN / admin-only.** Tasks are for Gracie, not the team; an unmanaged list is where GA loses people. → **[SETTLED]**
8. **Gracie is the task-keeper; users reach tasks via the assistant** ("what were last week's tasks, which are done?"). → **[SETTLED]**
9. **One database, split by OWNER** (never multiple DBs — so the feature toggles off as one thing). → **[SETTLED]**
10. **Owner assigned ONLY when a name is explicitly spoken**; else unassigned under the client (auto-assigning breeds "not my task" pushback). → **[SETTLED]**
11. **Two priorities: Standard / High.** High = stated important OR repeated; Gracie escalates on repetition. → **[SETTLED]**
12. **Archive, never delete (users).** Complete → archived; users get **Archive** only, **admins** get Delete. → **[SETTLED]**
13. **Aging:** standard tasks auto-archive after **~2 weeks** (GA cadence); **High persists** until done. → **[SETTLED]**
14. **Gracie closes tasks by listening** (in-meeting + from the daily-sync transcript). → **[SETTLED]**
15. **DEDUP is the keystone — check ACTIVE *and* ARCHIVED before creating ANY task.** If it exists, re-surface/escalate instead of duplicating; a re-mentioned **archived** task returns to the board as **High**. This is what makes "escalate on repeat" work and prevents the 284-duplicate mess. → **[SETTLED]**
16. **Cap ~3 active tasks per client**; over the cap Gracie must archive stale ones or consolidate; consolidation prompt keeps her at hundreds, not thousands. → **[SETTLED]**
17. **CSV download of tasks.** → **[SETTLED]** (not built; wanted).
18. **Passive per-meeting task summary** (Otter-style) → **[SETTLED] Keep it, but each entry LINKS to the single canonical task** (one board/DB) so repeats match the one record and escalate.
19. **No auto-task from every mention** (John Scott spitball) → falls out of #10/#11/#15: no name → unassigned, spitball → Standard, ages out. → **[SETTLED]**

## Sync-driven closing (rec #5/#6)
20. **Daily sync generates a transient due/overdue/stale agenda by client and closes items from the sync transcript** — in addition to per-meeting listening (#14). → **[SETTLED]**

## Assistant
21. **Home = the assistant page** (land talking to Gracie; pull everything else from her). → **[SETTLED direction]**
22. **NL retrieval across client history** (built #13) → **[SETTLED] Done; verify live.**

## In-meeting voice (Daniel's feature, #97/#99) — validated
23. **Voice pause + leave** ("Hey Gracie AI, stop recording 10 min" / "leave"). Wake word **"Hey Gracie AI"** (avoids false-trigger on "Grace & Associates"). → **[SETTLED]**
24. **Gracie only ever speaks/acts on her wake word** — no proactive interjections or prompts. → **[SETTLED principle]**
25. **Gracie texts back in the meeting chat** when invoked (voice-reply is years out via Recall; text is easy now) — builds on #99's `sendRecallChatMessage`. → **[SETTLED]**
26. **End-of-meeting report only if asked** (no automatic host-confirm prompt). Voice task-capture, if built, must be wake-word-gated ("Hey Gracie AI, action item: …"), never a bare passive trigger. → **[SETTLED]**

## Time zones
27. **Time display** → **[SETTLED]** App UI renders in the user's **device/browser local time** (UTC canonical underneath) so travelers see current-location time. The **daily EMAIL** (can't read the device at open) renders against a **settable profile timezone**, defaulted from the browser on first login.

## Calendar
28. **Week view = work week Mon–Fri** (drop Sat/Sun). → **[SETTLED]**
29. **Swap layout: day agenda LEFT, calendar RIGHT, expand the calendar** (reduce padding, reclaim left space) so it's readable in week + month. → **[SETTLED]**
30. **External-attendees list → collapsible dropdown** (closed by default), keeping the "create new client/prospect/lead/partner" action. → **[SETTLED]**
31. **Stale/duplicate calendar events** → **[SETTLED] Both:** (a) hygiene — Daniel + Allie + Cynthia link/clean 3–4 months of meetings, email Cynthia the ask; (b) rec #8 **join-check safeguard** — only record a meeting where **≥2 actually joined incl. a GA person**, + a per-user ignore list, so ghosts self-suppress. **KEY:** the join-check gates on *did the meeting happen*, NOT on whether a client is assigned — a real but unlinked meeting still records and saves under its domain (see #32).

## Unassigned-client meetings (94 need clients)
32. **Unassigned meeting → a Documents area named by DOMAIN** (e.g. `aperimeter.com`) so docs stay visible/findable; add a clients filter **All / Unassigned** to keep the real list clean. → **[SETTLED direction]**

## Rollout / misc
33. **Allie's post-meeting analysis prompt** — she'll send her long prompt; incorporate (relates to the #60 prompt editor). → **[OPEN] awaiting Allie's prompt.**
34. **Logo approved** (Kimberly's); **dark mode** shipped (#98). → **[SETTLED] Done.**
35. **Demo: full team in ~2 weeks**, order = daily email → assistant (live question) → transcripts+stills → tasks (framed as a proposal, lead with closing rules). → **[SETTLED plan]**
