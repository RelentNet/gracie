# In-meeting bot controls — decision record (for the Allie call, 2026-08-05)

**Status:** three PRs built by background agents. The **dark/light logo** PR is a normal ship. The **two bot-control PRs below are HELD (not merged)** so we can decide implementation with Allie first. This page is the plain-language summary to walk through in the call.

_PR links + build/gate status filled in once the agents report:_
- Logo (ship): **[PR #98](https://github.com/RelentNet/gracie/pull/98)** — reviewed, gates green (incl. full prod build), ready to merge on your go.
- Bot control buttons (HOLD): **[PR #97](https://github.com/RelentNet/gracie/pull/97)** — reviewed, gates green, secret-scan clean. Known limit: the "paused" banner is client-only, so it doesn't survive a page refresh — resolve (read real pause state from Recall) before shipping.
- Voice commands (HOLD): **[PR #99](https://github.com/RelentNet/gracie/pull/99)** — reviewed, gates green (146 tests, +20), secret-scan clean, safe DEFAULT-OFF. Well-built; before it ever ships, resolve: (1) **trigger looseness** — wake words include bare "grace"/"gracie" and commands are bare "leave"/"pause"/"stop", so normal host speech ("Grace, let's leave it there") could misfire; mitigated by host-only + chat confirmation + 30s debounce, not eliminated — tighten the phrase; (2) **host ≠ necessarily internal** — in a client-hosted meeting the *client* is the host and could command Gracie; decide whether to restrict to known-internal speakers; (3) **resume job swallows all errors** — a transient resume failure is treated like a benign no-op, so a paused recording could stay paused with no retry/alert.

---

## What people asked for
Let meeting participants control Gracie's notetaker mid-meeting — e.g. "Gracie, leave the meeting" or "Gracie, stop listening for 5 minutes."

## Feasibility: yes
Every piece exists in Recall's API, and we already built the hardest part (the live-transcript stream, #79). Two ways to expose it, built as two separate PRs so we can pick one, both, or neither.

## Option A — Buttons on the meeting page (the safe, simple one)
On a meeting's page, while Gracie is in the call, staff see:
- **Remove Gracie from this meeting** (with a confirm — she won't rejoin).
- **Pause recording / Resume** — a manual toggle, with a loud "recording is paused" banner so it can't be forgotten.

**Why it's low-risk:** these are direct API calls that work on *any* meeting regardless of transcription settings. Nothing can misfire — a human clicks the button. No trade-offs.
**Limitation:** you have to be at the Gracie dashboard, not just in the meeting.

## Option B — Voice commands (the impressive one, with a real trade-off)
Say "Hey Gracie, leave" or "Hey Gracie, stop listening for 5 minutes" out loud; the bot obeys within a few seconds and posts a confirmation in the meeting chat. Timed pauses auto-resume on their own. Default OFF; opt-in per firm.

**Safety built in:** only internal/host speakers are honored, a visible chat confirmation is always posted, and repeated/overlapping phrases are debounced so it can't double-fire.

**⚠️ The trade-off to decide with Allie:** voice commands need Gracie's *live* transcript running during the meeting. Turning that on switches her to a live transcription provider — and Recall only allows **one** transcript per recording — so the live transcript **replaces the reliable after-the-meeting transcript** we currently depend on for the write-ups. That reliable provider is exactly the one we're finishing the `recording.done` cutover to lock in. In short: **voice control today costs us some transcription reliability.** Two mishears could also, in principle, act on a stray phrase — mitigated by the internal-speaker gate + confirmation, but not zero.

## Recommendation
1. **Ship Option A (buttons) whenever** — pure upside, no trade-off, covers "get Gracie out / pause her" for anyone at the dashboard.
2. **Hold Option B (voice)** until the `recording.done` transcription cutover is proven, then decide if the "speak to control her" wow-factor is worth riding on the less-reliable live-transcript path. If yes, enable it per-meeting for internal calls first, never a client call, until we trust it.

_Ask Allie: does she actually want to talk to Gracie in the room, or are dashboard buttons enough? That answer decides whether B is worth the transcription trade-off._
