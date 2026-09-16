/**
 * Support requests — client-safe shared bits (labels + the auto-captured context).
 * Imported by the Support page, the admin inbox, and the API route.
 */

export const SUPPORT_CATEGORIES = [
  { value: 'problem', label: 'Something isn’t working' },
  { value: 'cant_do', label: 'Gracie couldn’t do what I asked' },
  { value: 'idea', label: 'Idea or request' },
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]['value'];
export type SupportStatus = 'open' | 'done';

export const SUPPORT_MESSAGE_MAX = 5000;

export function isSupportCategory(value: unknown): value is SupportCategory {
  return SUPPORT_CATEGORIES.some((c) => c.value === value);
}

export function supportCategoryLabel(value: string): string {
  return SUPPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** One support request as shown to its author or in the admin inbox. */
export interface SupportRequestView {
  readonly id: string;
  readonly category: SupportCategory;
  readonly message: string;
  readonly pageUrl: string | null;
  readonly appVersion: string | null;
  readonly browser: string | null;
  readonly screen: string | null;
  readonly status: SupportStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  /** Author name — admin inbox only. */
  readonly userName?: string | null;
}

/** Best-effort short browser name from a user-agent string (order matters). Pure. */
export function browserName(userAgent: string): string {
  const ua = userAgent;
  if (/DuckDuckGo/i.test(ua)) return 'DuckDuckGo';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown browser';
}

/**
 * "1280×660 window · 150% zoom · 1920×1200 screen" — the layout facts support
 * needs (display scaling is why Scott's Sign Out disappeared). Pure.
 */
export function describeScreen(input: {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
}): string {
  const zoom = Math.round(input.devicePixelRatio * 100);
  const physW = Math.round(input.screenWidth * input.devicePixelRatio);
  const physH = Math.round(input.screenHeight * input.devicePixelRatio);
  return `${input.innerWidth}×${input.innerHeight} window · ${zoom}% zoom · ${physW}×${physH} screen`;
}
