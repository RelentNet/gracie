/**
 * Brand presets — the white-label identities an operator can switch between
 * (Settings → Company → Branding).
 *
 * A preset is a product NAME plus a small set of `--color-*` / `--brand-*`
 * overrides. theme.css documents why that is enough: re-declaring those same
 * variables retints every Tailwind utility AND every inline `var(--…)` usage at
 * once, so switching brand touches no component.
 *
 * PURE + no `server-only`: GET /api/bootstrap serializes the CSS server-side and the
 * settings panel renders the swatches client-side, so both import this.
 *
 * Contrast: light-mode `--brand` carries text and links, so each preset's light
 * brand is darkened to stay AA on white; the dark variant is lightened for the
 * same reason against the dark ground.
 */

/** CSS custom properties a preset may override, per theme. */
export type BrandVars = Readonly<Record<string, string>>;

export interface BrandPreset {
  readonly id: string;
  /** Product name shown in the nav, the tab title and the bot's display name. */
  readonly productName: string;
  /** One line for the settings card — what this identity feels like. */
  readonly tagline: string;
  /** Representative colour for the settings swatch (light-mode brand). */
  readonly swatch: string;
  readonly light: BrandVars;
  readonly dark: BrandVars;
}

export const BRAND_PRESETS: readonly BrandPreset[] = [
  {
    // The product's own look — theme.css's values, restated so switching back from
    // another preset restores them. The default: a deployment picks its brand in
    // Settings → Company → Branding (hq: relentnet), never by changing this.
    id: 'gracie',
    productName: 'Gracie',
    tagline: 'Indigo and slate — the Gracie default',
    swatch: '#4a5fd0',
    light: {
      '--brand': '#4a5fd0',
      '--brand-ink': '#3a49b8',
      '--brand-soft': 'rgba(74, 95, 208, 0.12)',
      '--color-blue-500': '#4a5fd0',
      '--color-blue-600': '#4257c9',
      '--color-blue-700': '#3a49b8',
      '--color-navy-900': '#0f172a',
      '--color-navy-800': '#1e293b',
      '--color-navy-700': '#1e293b',
      '--bg-0': '#e7ebf7',
    },
    dark: {
      '--brand': '#8296ff',
      '--brand-ink': '#a3b3ff',
      '--brand-soft': 'rgba(130, 150, 255, 0.16)',
      '--color-blue-500': '#5567db',
      '--color-blue-600': '#5468dc',
      '--color-blue-700': '#a9b7ff',
      '--color-navy-900': '#0f172a',
      '--color-navy-800': '#263248',
      '--color-navy-700': '#2b3a57',
      '--bg-0': '#0b0f1d',
    },
  },
  {
    // relentnet-brandkit/relentnet-tokens.css: black ground, gold accent, warm
    // neutrals. Light mode darkens the gold (#cbab45 is ~2:1 on white) to keep
    // text and links AA; dark mode uses the brand gold as-is.
    id: 'relentnet',
    productName: 'RelentNet',
    tagline: 'Black and gold — RelentNet house style',
    swatch: '#cbab45',
    light: {
      '--brand': '#7a6524',
      '--brand-ink': '#6b5a24',
      '--brand-soft': 'rgba(203, 171, 69, 0.16)',
      '--color-blue-500': '#7a6524',
      '--color-blue-600': '#6b5a24',
      '--color-blue-700': '#5c4d1e',
      '--color-navy-900': '#050505',
      '--color-navy-800': '#171614',
      '--color-navy-700': '#171614',
      '--bg-0': '#efece5',
    },
    dark: {
      '--brand': '#cbab45',
      '--brand-ink': '#dfac0a',
      '--brand-soft': 'rgba(203, 171, 69, 0.16)',
      '--color-blue-500': '#cbab45',
      '--color-blue-600': '#b8983a',
      '--color-blue-700': '#dfac0a',
      '--color-navy-900': '#050505',
      '--color-navy-800': '#171614',
      '--color-navy-700': '#171614',
      '--bg-0': '#050505',
    },
  },
  {
    id: 'cam',
    productName: 'Cam',
    tagline: 'Cambridge navy and amber — your brand',
    swatch: '#9a6b18',
    light: {
      '--brand': '#9a6b18',
      '--brand-ink': '#7d5612',
      '--brand-soft': 'rgba(200, 146, 60, 0.15)',
      '--color-blue-500': '#9a6b18',
      '--color-blue-600': '#8a5f15',
      '--color-blue-700': '#7d5612',
      '--color-navy-900': '#0b1b25',
      '--color-navy-800': '#1b2830',
      '--color-navy-700': '#1b2830',
      '--bg-0': '#ece7dd',
    },
    dark: {
      '--brand': '#d9a752',
      '--brand-ink': '#e6bd7a',
      '--brand-soft': 'rgba(216, 167, 82, 0.16)',
      '--color-blue-500': '#d9a752',
      '--color-blue-600': '#c8923c',
      '--color-blue-700': '#e6bd7a',
      '--color-navy-900': '#0b1b25',
      '--color-navy-800': '#1b2830',
      '--color-navy-700': '#1b2830',
      '--bg-0': '#0d1720',
    },
  },
  {
    id: 'bridget',
    productName: 'Bridget',
    tagline: 'Warm clay and stone — reads as a colleague',
    swatch: '#a85a3c',
    light: {
      '--brand': '#a85a3c',
      '--brand-ink': '#8a4730',
      '--brand-soft': 'rgba(168, 90, 60, 0.14)',
      '--color-blue-500': '#a85a3c',
      '--color-blue-600': '#964f34',
      '--color-blue-700': '#8a4730',
      '--color-navy-900': '#2a1f1b',
      '--color-navy-800': '#3a2b25',
      '--color-navy-700': '#3a2b25',
      '--bg-0': '#efe7e1',
    },
    dark: {
      '--brand': '#e2937a',
      '--brand-ink': '#eeae99',
      '--brand-soft': 'rgba(226, 147, 122, 0.16)',
      '--color-blue-500': '#e2937a',
      '--color-blue-600': '#d07e63',
      '--color-blue-700': '#eeae99',
      '--color-navy-900': '#1c1513',
      '--color-navy-800': '#2a1f1b',
      '--color-navy-700': '#2a1f1b',
      '--bg-0': '#15100e',
    },
  },
  {
    id: 'foreman',
    productName: 'Foreman',
    tagline: 'Graphite and safety orange — industrial',
    swatch: '#b2560f',
    light: {
      '--brand': '#b2560f',
      '--brand-ink': '#8f440c',
      '--brand-soft': 'rgba(178, 86, 15, 0.14)',
      '--color-blue-500': '#b2560f',
      '--color-blue-600': '#9e4c0d',
      '--color-blue-700': '#8f440c',
      '--color-navy-900': '#14191c',
      '--color-navy-800': '#1b2830',
      '--color-navy-700': '#1b2830',
      '--bg-0': '#e6e8ea',
    },
    dark: {
      '--brand': '#f08a3c',
      '--brand-ink': '#f5a468',
      '--brand-soft': 'rgba(240, 138, 60, 0.16)',
      '--color-blue-500': '#f08a3c',
      '--color-blue-600': '#dd7526',
      '--color-blue-700': '#f5a468',
      '--color-navy-900': '#0e1215',
      '--color-navy-800': '#14191c',
      '--color-navy-700': '#14191c',
      '--bg-0': '#0b0e10',
    },
  },
  {
    id: 'sitelines',
    productName: 'Sitelines',
    tagline: 'Cool slate and teal — neutral product',
    swatch: '#1a6a7d',
    light: {
      '--brand': '#1a6a7d',
      '--brand-ink': '#145564',
      '--brand-soft': 'rgba(26, 106, 125, 0.13)',
      '--color-blue-500': '#1a6a7d',
      '--color-blue-600': '#175d6e',
      '--color-blue-700': '#145564',
      '--color-navy-900': '#0f1e24',
      '--color-navy-800': '#1c2f38',
      '--color-navy-700': '#1c2f38',
      '--bg-0': '#e4ecef',
    },
    dark: {
      '--brand': '#5cc4d8',
      '--brand-ink': '#87d6e5',
      '--brand-soft': 'rgba(92, 196, 216, 0.16)',
      '--color-blue-500': '#5cc4d8',
      '--color-blue-600': '#3aa9bf',
      '--color-blue-700': '#87d6e5',
      '--color-navy-900': '#0a171c',
      '--color-navy-800': '#0f1e24',
      '--color-navy-700': '#0f1e24',
      '--bg-0': '#081317',
    },
  },
];

export const DEFAULT_BRAND_PRESET_ID = 'gracie';

/** Resolve a stored preset id to its preset; unknown/absent → the default. */
export function resolveBrandPreset(id: string | null | undefined): BrandPreset {
  const found = BRAND_PRESETS.find((p) => p.id === id);
  return found ?? BRAND_PRESETS.find((p) => p.id === DEFAULT_BRAND_PRESET_ID)!;
}

/** Serialize one theme's vars into a CSS declaration body. */
function declarations(vars: BrandVars): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('');
}

/**
 * The `<style>` body that applies a preset, mirroring theme.css's cascade:
 * light on `:root`, dark under both the explicit `data-theme` and the OS
 * preference. Every selector doubles `:root` so it outranks theme.css's matching rule
 * on specificity alone: the SPA may load the stylesheet before or after this block
 * (the cached pre-paint copy in index.html, Vite's dev style tags), so source order
 * cannot be relied on.
 */
export function brandPresetCss(preset: BrandPreset): string {
  const light = declarations(preset.light);
  const dark = declarations(preset.dark);
  return (
    `:root:root,:root:root[data-theme='light']{${light}}` +
    `@media (prefers-color-scheme: dark){:root:root:not([data-theme='light']){${dark}}}` +
    `:root:root[data-theme='dark']{${dark}}`
  );
}
