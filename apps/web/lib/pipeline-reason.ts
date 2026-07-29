/**
 * Plain-language pipeline state → reason mapping. Pure and dependency-light on
 * purpose: no `server-only`, no DB import, so BOTH the Pipeline fleet view
 * (client) and the meeting-occurrence detail page can import `describePipelineState`.
 *
 * Operability rule (brief §6): a non-technical staffer reads the `headline`; the
 * raw provider/error code lives in `detail` (tooltip/details), never as the
 * headline. Never a raw enum or provider code up front.
 *
 * NOTE: true recoverability classification (regenerate / retranscribe /
 * unrecoverable via a Recall pre-flight) is brief §3.2 — DEFERRED to a follow-on
 * session. `hasRecording` here is the cheap proxy the app already uses (a bot job
 * exists), not a Recall check.
 */

/** Unified fleet state shown in the Pipeline activity feed. */
export type FleetState = 'success' | 'partial' | 'failed' | 'in_progress' | 'needs_attention' | 'skipped';

/** A displayable reason: `headline` for staff, `detail` for support (raw code/message). */
export interface FleetReason {
  readonly headline: string;
  /** Raw error/provider text for a tooltip or details row; never the headline. */
  readonly detail: string | null;
}

export interface DescribeInput {
  readonly state: FleetState;
  /** Raw `pipeline_runs.error_message` (or watchdog note), if any. */
  readonly errorMessage?: string | null;
  /**
   * Cheap proxy for "a recording exists to recover from" — a bot job id is present.
   * Not a Recall pre-flight (that's §3.2, deferred).
   */
  readonly hasRecording?: boolean;
}

/** Does the raw message look like the transcription-provider failure (§3.2 example)? */
function isProviderTranscriptFailure(raw: string): boolean {
  return /provider_connection_failed|transcript/i.test(raw);
}

/**
 * Map a fleet state (+ optional raw message) to a plain-language reason. Exported
 * and pure so the meeting-occurrence page can reuse it verbatim.
 */
export function describePipelineState(input: DescribeInput): FleetReason {
  const raw = input.errorMessage?.trim() ?? '';
  const detail = raw === '' ? null : raw;

  switch (input.state) {
    case 'success':
      return { headline: 'Notes and documents were created.', detail: null };

    case 'partial':
      return {
        headline: 'Notes were created, but the task checklist couldn’t be read — some follow-ups may be missing. A re-run usually fixes it.',
        detail,
      };

    case 'in_progress':
      return { headline: 'Working on it — notes are being generated now.', detail };

    case 'skipped':
      // The duplicate-invite skip note is already written in plain language.
      return { headline: detail ?? 'Skipped — no notes were needed for this meeting.', detail };

    case 'needs_attention':
      if (input.hasRecording === false) {
        return { headline: 'No recording was captured — there’s nothing to recover.', detail };
      }
      return {
        headline: 'This meeting was recorded, but note generation never started. Re-run to create the notes.',
        detail,
      };

    case 'failed':
      if (input.hasRecording === false) {
        return { headline: 'No recording was captured — there’s nothing to recover.', detail };
      }
      if (raw !== '' && isProviderTranscriptFailure(raw)) {
        return { headline: 'The recording is fine, but the notes couldn’t be created. Re-run to try again.', detail };
      }
      return { headline: 'Something went wrong while creating the notes. A re-run usually fixes it.', detail };

    default:
      return { headline: 'Status unknown — open the meeting for details.', detail };
  }
}
