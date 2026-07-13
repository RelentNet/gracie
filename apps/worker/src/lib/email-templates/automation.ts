/**
 * Automation email (P8) — a generic GA-branded shell around one automation's
 * deterministic output (a report/digest/reminder body, or a client message). The
 * body is plain multi-line text rendered with line breaks; the title + optional
 * intro frame it. Reuses the shared email layout so it renders like every other
 * Gracie email. `internal` toggles the footnote between team-only and a
 * client-facing note (the gated customer-contact exception).
 */
import { button, muted, preText, renderEmailLayout } from './layout.js';

import type { RenderedEmail } from './daily-sync.js';

/** Inputs for {@link renderAutomationEmail}. */
export interface AutomationEmailInput {
  /** Heading (the automation title, or the client message subject). */
  readonly title: string;
  /** Optional one-line intro under the heading. */
  readonly intro?: string | null;
  /** The deterministic body text (multi-line; rendered with <br>). */
  readonly body: string;
  /** Optional in-app link (relative or absolute) → an "Open in Gracie" button. */
  readonly link?: string | null;
  readonly appUrl: string;
  /** Internal (team) email vs. a client-facing one (changes the footnote only). */
  readonly internal: boolean;
}

/** Render an automation email (report/digest/reminder or a gated client message). */
export function renderAutomationEmail(input: AutomationEmailInput): RenderedEmail {
  const sections: string[] = [];
  if (input.intro !== undefined && input.intro !== null && input.intro.trim() !== '') {
    sections.push(muted(input.intro));
  }
  sections.push(preText(input.body));
  if (input.link !== undefined && input.link !== null && input.link.trim() !== '') {
    const href = input.link.startsWith('http') ? input.link : `${input.appUrl}${input.link}`;
    sections.push(button('Open in Gracie', href));
  }

  const html = renderEmailLayout({
    title: input.title,
    preheader: input.intro ?? input.title,
    bodyHtml: sections.join(''),
    footnote: input.internal
      ? 'Automated by Gracie for Grace & Associates — internal only.'
      : 'Sent by Grace & Associates via Gracie.',
  });

  const textLines = [
    input.title,
    ...(input.intro !== undefined && input.intro !== null && input.intro.trim() !== '' ? ['', input.intro] : []),
    '',
    input.body,
    ...(input.link !== undefined && input.link !== null && input.link.trim() !== ''
      ? ['', `Open: ${input.link.startsWith('http') ? input.link : `${input.appUrl}${input.link}`}`]
      : []),
  ];

  return { subject: input.title, html, text: textLines.join('\n') };
}
