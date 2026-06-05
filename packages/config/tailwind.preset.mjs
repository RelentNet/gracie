// Tailwind CSS v4 shared preset.
//
// NOTE: Tailwind v4 is CSS-first. The canonical design tokens (color scale,
// fonts, radii) live in `apps/web/styles/theme.css` via the `@theme` directive
// (see docs/08 §2). This module only carries the `content` globs and any
// JS-side options that must be shared across apps. Keep token definitions in
// CSS — do not duplicate them here.

/** @type {Partial<import('tailwindcss').Config>} */
export const tailwindPreset = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
};

export default tailwindPreset;
