/**
 * Worker email service (P7) — the ONLY thing processors call to send email. Wraps
 * the allowlist-gated {@link sendEmail} choke-point with `from` resolution
 * (`RESEND_FROM`) and provides the admin-alert helper (§5). No processor imports
 * `resend.ts` or the Resend API directly.
 */
import { getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';

import { renderAlertEmail } from './email-templates/alert.js';
import { getAppBaseUrl, getResendFrom } from './notify-config.js';
import { sendEmail, type EmailLogger, type SendEmailResult } from './resend.js';

/** The content of one team email (recipients are allowlist-gated downstream). */
export interface TeamEmailInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
}

/** Shared deps: a logger, and optionally a reused DB handle. */
export interface EmailDeps {
  readonly logger: EmailLogger;
  readonly db?: ServerClient;
}

/**
 * Send an internal/team email. `from` resolves via `RESEND_FROM` (env → resend
 * integration config → GA default); recipients are filtered to the allowlist
 * inside `sendEmail`. Throws on a non-OK Resend response (BullMQ retries).
 */
export async function sendTeamEmail(input: TeamEmailInput, deps: EmailDeps): Promise<SendEmailResult> {
  const db = deps.db ?? getServerClient();
  const from = await getResendFrom(db);
  return sendEmail(
    { from, to: input.to, subject: input.subject, html: input.html, text: input.text },
    { logger: deps.logger },
  );
}

/** Alert classes that email admins (P7 §5). Maps to a human label for the email. */
export type AdminAlertType = 'pipeline_failed' | 'needs_attention' | 'calendar_disconnect' | 'kb_expiring';

const ALERT_LABELS: Record<AdminAlertType, string> = {
  pipeline_failed: 'Pipeline failure',
  needs_attention: 'Transcript overdue',
  calendar_disconnect: 'Calendar disconnected',
  kb_expiring: 'Knowledge base document expiring',
};

/** A raised alert to notify admins about. */
export interface AdminAlert {
  readonly type: AdminAlertType;
  /** Specific title (which meeting/client/doc). */
  readonly title: string;
  readonly body?: string | null;
  /** Relative in-app link (e.g. `/clients/123`). */
  readonly link?: string | null;
}

/**
 * Email all ACTIVE admins about an alert (allowlist-gated). BEST-EFFORT: this
 * never throws — an alert-email failure must not fail the primary job (e.g. it is
 * called from the generation failure path). The in-app notification to the
 * relevant user is written separately by the caller and is the source of truth.
 */
export async function emailAdminsForAlert(alert: AdminAlert, deps: EmailDeps): Promise<void> {
  const db = deps.db ?? getServerClient();
  try {
    const { data, error } = await db
      .from('users')
      .select('email')
      .eq('role', 'admin')
      .is('deactivated_at', null);
    if (error !== null) throw new Error(error.message);

    const emails = (data ?? []).map((r) => r.email).filter((e) => e.trim() !== '');
    if (emails.length === 0) {
      deps.logger.info({ type: alert.type }, 'emailAdminsForAlert: no active admins — skipping');
      return;
    }

    const rendered = renderAlertEmail({
      alertLabel: ALERT_LABELS[alert.type],
      title: alert.title,
      body: alert.body ?? null,
      link: alert.link ?? null,
      appUrl: getAppBaseUrl(),
    });
    await sendTeamEmail(
      { to: emails, subject: rendered.subject, html: rendered.html, text: rendered.text },
      { logger: deps.logger, db },
    );
  } catch (err) {
    deps.logger.warn(
      { err: err instanceof Error ? err.message : String(err), type: alert.type },
      'emailAdminsForAlert: failed (non-fatal)',
    );
  }
}
