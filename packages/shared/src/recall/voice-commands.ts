/**
 * In-meeting VOICE commands — the PURE detection logic (no I/O, unit-tested).
 *
 * A participant speaks a wake phrase + a command ("hey Gracie, leave the meeting"
 * / "Gracie, stop listening for 5 minutes") and the realtime transcript pipeline
 * (#79) turns it into a bot action. Two pure functions live here so both the
 * detection and the safety gate are testable without a live call:
 *   - {@link parseVoiceCommand} — the utterance text → a command (or null);
 *   - {@link parseRealtimeParticipant} — the `transcript.data` participant subset
 *     the webhook gates on (host-only), surfaced defensively.
 *
 * Everything is inert unless BOTH the realtime transcript AND the `voiceCommands`
 * toggle are on — this module only says WHAT was said, never decides to act. The
 * webhook (`apps/web/.../recall/transcript`) applies the config + host gate and
 * fires the (rare) action fire-and-forget.
 */

/** A recognised in-meeting voice command. */
export type VoiceCommand =
  | { readonly kind: 'leave' }
  /** Pause recording for `minutes` (clamped 1–60), then auto-resume. */
  | { readonly kind: 'pause'; readonly minutes: number };

/** Default pause length when a duration isn't spoken. */
export const DEFAULT_PAUSE_MINUTES = 5;
/** Pause length is clamped to this range (a spoken "for N minutes" outside it is coerced). */
export const MIN_PAUSE_MINUTES = 1;
export const MAX_PAUSE_MINUTES = 60;

/**
 * Wake phrases, STT-tolerant. Longest first so "hey gracie" is preferred over the
 * bare "grace" when both could match. "grace" is deliberately included (Recall's
 * ASR routinely drops the trailing "-ie") but is only ever ACTED on together with
 * a command verb below AND the host-only gate — the firm name "Grace & Associates"
 * on its own never yields a command.
 */
const WAKE_PHRASES = ['hey gracie', 'gracie ai', 'gracie', 'grace'] as const;

/** Small spoken-number map — STT often spells short durations as words, not digits. */
const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
};

/** Lowercase, strip punctuation to spaces, collapse whitespace (digits kept). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text AFTER the last wake phrase (the command portion), or null if none present. */
function afterWakePhrase(normalized: string): string | null {
  let best: number | null = null;
  for (const phrase of WAKE_PHRASES) {
    // Match the wake phrase as whole words so "disgrace" / "gracious" don't wake.
    const re = new RegExp(`(?:^|\\s)${phrase}(?:\\s|$)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      const end = m.index + m[0].length;
      if (best === null || end > best) best = end;
    }
  }
  return best === null ? null : normalized.slice(best).trim();
}

/** Parse a spoken duration from the command text; DEFAULT when unspoken, clamped 1–60. */
function parsePauseMinutes(rest: string): number {
  // "for 5 minutes" / "5 min" / "for five minutes" — digits or a common word number.
  const digit = rest.match(/(\d{1,3})\s*(?:minute|minutes|min|mins|m)\b/);
  let n: number | null = digit?.[1] !== undefined ? Number.parseInt(digit[1], 10) : null;
  if (n === null) {
    const word = rest.match(/\b([a-z]+)\s*(?:minute|minutes|min|mins)\b/)?.[1];
    if (word !== undefined && word in WORD_NUMBERS) n = WORD_NUMBERS[word] ?? null;
  }
  if (n === null || !Number.isFinite(n)) return DEFAULT_PAUSE_MINUTES;
  return Math.min(MAX_PAUSE_MINUTES, Math.max(MIN_PAUSE_MINUTES, Math.floor(n)));
}

/**
 * Parse one utterance into a {@link VoiceCommand}, or null when it isn't one.
 * Requires a wake phrase AND a command verb in the text that follows it, so plain
 * conversation (or the firm name alone) never matches. PURE; unit-tested.
 *
 *   leave  — "leave" / "leave the meeting" / "leave the call" / "you can leave now"
 *   pause  — "pause" / "stop listening" / "stop recording" [+ "for N minutes"]
 *
 * "leave" wins if both appear (leaving also stops the recording — the safer read).
 */
export function parseVoiceCommand(text: string): VoiceCommand | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const rest = afterWakePhrase(normalize(text));
  if (rest === null || rest === '') return null;

  if (/\bleave\b/.test(rest)) return { kind: 'leave' };
  if (/\bpause\b/.test(rest) || /\bstop\s+(?:listening|recording|the recording)\b/.test(rest)) {
    return { kind: 'pause', minutes: parsePauseMinutes(rest) };
  }
  return null;
}

/** Participant subset surfaced from a `transcript.data` event for the host gate. */
export interface RealtimeParticipant {
  readonly name: string | null;
  /** Recall's host flag, when the platform reports it; null when absent (fail safe). */
  readonly isHost: boolean | null;
  /** Participant email, when the platform reports it (rare on realtime); else null. */
  readonly email: string | null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

/**
 * Surface the participant of a realtime `transcript.data` event for the safety gate.
 * The utterance nests at `data.data.participant` (same envelope
 * {@link parseRealtimeTranscript} reads). `is_host` is Recall's per-platform host
 * flag — the ONE signal the webhook gates on; when the platform omits it we return
 * `null` and the caller fails safe (does NOT act). Email is surfaced when present
 * (rare on realtime) for logging only. Returns null when there's no participant.
 * PURE; unit-tested.
 */
export function parseRealtimeParticipant(raw: unknown): RealtimeParticipant | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = (raw as Record<string, unknown>).data;
  const inner = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).data : null;
  const participant =
    typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>).participant : null;
  if (typeof participant !== 'object' || participant === null) return null;

  const p = participant as Record<string, unknown>;
  const extra = typeof p.extra_data === 'object' && p.extra_data !== null ? (p.extra_data as Record<string, unknown>) : {};
  return {
    name: firstString(p.name),
    isHost: typeof p.is_host === 'boolean' ? p.is_host : null,
    email: firstString(p.email, extra.email),
  };
}
