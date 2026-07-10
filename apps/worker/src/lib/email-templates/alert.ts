/**
 * System-alert email (P7 §5) — sent to ADMINS ONLY (allowlist-gated) when an
 * operational notification is raised: pipeline failure, overdue transcript,
 * calendar disconnect, or a KB doc nearing expiry. Concise: what happened, which
 * entity, and a link back into the app. The in-app notification still goes to the
 * relevant user; only this email is admin-scoped.
 */
import { button, h2, muted, p, renderEmailLayout } from './layout.js';

import type { RenderedEmail } from './daily-sync.js';

/** Inputs for {@link renderAlertEmail}. */
export interface AlertEmailInput {
  /** Human label for the alert class (e.g. "Pipeline failure"). */
  readonly alertLabel: string;
  /** The notification title (specific: which meeting/client/doc). */
  readonly title: string;
  /** Optional detail line. */
  readonly body?: string | null;
  /** Optional relative in-app link (e.g. `/clients/123`). */
  readonly link?: string | null;
  readonly appUrl: string;
}

/** Render an admin alert email. */
export function renderAlertEmail(input: AlertEmailInput): RenderedEmail {
  const subject = `[Gracie alert] ${input.alertLabel}: ${input.title}`;

  const sections: string[] = [];
  sections.push(h2(input.alertLabel));
  sections.push(p(input.title));
  if (input.body !== undefined && input.body !== null && input.body.trim() !== '') {
    sections.push(muted(input.body));
  }
  if (input.link !== undefined && input.link !== null && input.link.trim() !== '') {
    const href = input.link.startsWith('http') ? input.link : `${input.appUrl}${input.link}`;
    sections.push(button('Open in Gracie', href));
  }

  const html = renderEmailLayout({
    title: 'System alert',
    preheader: `${input.alertLabel}: ${input.title}`,
    bodyHtml: sections.join(''),
    footnote: 'Automated system alert for Grace & Associates admins.',
  });

  const textLines = [
    `[Gracie alert] ${input.alertLabel}`,
    '',
    input.title,
    ...(input.body !== undefined && input.body !== null && input.body.trim() !== '' ? ['', input.body] : []),
    ...(input.link !== undefined && input.link !== null && input.link.trim() !== ''
      ? ['', `Open: ${input.link.startsWith('http') ? input.link : `${input.appUrl}${input.link}`}`]
      : []),
  ];

  return { subject, html, text: textLines.join('\n') };
}
