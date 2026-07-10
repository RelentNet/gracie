/**
 * GA-branded HTML email shell + small inline-styled block helpers (P7 §4). Plain,
 * robust, table-based, ALL styles inline, NO external assets/fonts/images — so the
 * layout survives Outlook/Gmail rendering. Shared by the daily-sync, pre-meeting
 * brief, and alert emails. Every helper escapes its text input.
 */

/** GA brand palette (email-safe hex; the app's CSS vars are unavailable here). */
const NAVY = '#10233f';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ACCENT = '#2563eb';
const CARD_BG = '#ffffff';
const PAGE_BG = '#f3f4f6';

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A section heading. */
export function h2(text: string): string {
  return `<h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:${NAVY};">${escapeHtml(text)}</h2>`;
}

/** A body paragraph. */
export function p(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:${INK};">${escapeHtml(text)}</p>`;
}

/** Muted secondary line (e.g. an empty-state note). */
export function muted(text: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(text)}</p>`;
}

/** An unordered list from already-safe or plain-text items (each item escaped). */
export function ul(items: readonly string[]): string {
  if (items.length === 0) return '';
  const lis = items
    .map((item) => `<li style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${INK};">${escapeHtml(item)}</li>`)
    .join('');
  return `<ul style="margin:0 0 12px;padding-left:20px;">${lis}</ul>`;
}

/** A row of small stat chips (label + value), e.g. yesterday's counts. */
export function statRow(stats: ReadonlyArray<{ label: string; value: string | number }>): string {
  const cells = stats
    .map(
      (s) =>
        `<td style="padding:8px 12px;border:1px solid ${BORDER};border-radius:6px;">` +
        `<div style="font-size:20px;font-weight:700;color:${NAVY};">${escapeHtml(String(s.value))}</div>` +
        `<div style="font-size:12px;color:${MUTED};">${escapeHtml(s.label)}</div></td>`,
    )
    .join('<td style="width:8px;"></td>');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr>${cells}</tr></table>`;
}

/** A bordered content box (used for each pre-meeting brief). `innerHtml` is trusted. */
export function box(innerHtml: string): string {
  return (
    `<div style="margin:0 0 12px;padding:12px 14px;border:1px solid ${BORDER};` +
    `border-radius:8px;background:#fafafa;">${innerHtml}</div>`
  );
}

/** Render multi-line plain text as escaped HTML with <br> line breaks. */
export function preText(text: string): string {
  return `<div style="font-size:13px;line-height:1.5;color:${INK};">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

/** A primary action button (link). */
export function button(label: string, href: string): string {
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:8px 0 4px;padding:10px 18px;` +
    `background:${ACCENT};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">` +
    `${escapeHtml(label)}</a>`
  );
}

/** Input to {@link renderEmailLayout}. */
export interface EmailLayoutInput {
  /** The heading shown in the navy header bar and the document title. */
  readonly title: string;
  /** Hidden preview text shown by mail clients in the inbox list. */
  readonly preheader?: string;
  /** Pre-built, trusted inner HTML (assembled from the helpers above). */
  readonly bodyHtml: string;
  /** Small print under the card (e.g. "Internal — Grace & Associates only"). */
  readonly footnote?: string;
}

/**
 * Wrap pre-built body HTML in the GA email shell. Returns a complete HTML
 * document. The header carries the GA wordmark; the footer states the
 * internal-only nature of Gracie email.
 */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const preheader =
    input.preheader !== undefined
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>`
      : '';
  const footnote =
    input.footnote !== undefined
      ? `<p style="margin:12px 4px 0;font-size:11px;color:${MUTED};">${escapeHtml(input.footnote)}</p>`
      : '';
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(input.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${PAGE_BG};">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">` +
    `<tr><td style="background:${NAVY};padding:16px 24px;border-radius:10px 10px 0 0;">` +
    `<span style="font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">Grace &amp; Associates</span>` +
    `<span style="font-size:13px;color:#c7d2e5;"> · Gracie</span></td></tr>` +
    `<tr><td style="background:${CARD_BG};padding:24px;border:1px solid ${BORDER};border-top:none;border-radius:0 0 10px 10px;">` +
    `<h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:${NAVY};">${escapeHtml(input.title)}</h1>` +
    input.bodyHtml +
    `</td></tr></table>` +
    footnote +
    `</td></tr></table></body></html>`
  );
}
