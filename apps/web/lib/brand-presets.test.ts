import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BRAND_PRESETS,
  DEFAULT_BRAND_PRESET_ID,
  brandPresetCss,
  resolveBrandPreset,
} from './brand-presets.js';

test('resolveBrandPreset: unknown, null and undefined all fall back to the default', () => {
  for (const input of ['nope', null, undefined]) {
    assert.equal(resolveBrandPreset(input).id, DEFAULT_BRAND_PRESET_ID);
  }
});

test('resolveBrandPreset: a known id returns that preset', () => {
  for (const preset of BRAND_PRESETS) {
    assert.equal(resolveBrandPreset(preset.id).id, preset.id);
  }
});

/**
 * The switch overwrites variables, it never unsets them. If one preset declared a
 * var another omitted, switching would leave the previous brand's value behind on
 * that var — a half-rebranded UI. Every preset must cover the same key set.
 */
test('every preset declares the same variables, in both themes', () => {
  const expected = Object.keys(BRAND_PRESETS[0]!.light).sort();
  for (const preset of BRAND_PRESETS) {
    assert.deepEqual(Object.keys(preset.light).sort(), expected, `${preset.id} light`);
    assert.deepEqual(Object.keys(preset.dark).sort(), expected, `${preset.id} dark`);
  }
});

test('presets have distinct ids, names and swatches', () => {
  for (const field of ['id', 'productName', 'swatch'] as const) {
    const values = BRAND_PRESETS.map((p) => p[field]);
    assert.equal(new Set(values).size, values.length, `duplicate ${field}`);
  }
});

test('brandPresetCss: emits the light rule plus both dark paths', () => {
  const css = brandPresetCss(resolveBrandPreset('foreman'));
  // `:root:root` outranks theme.css's `:root` rules whatever order the two load in.
  assert.match(css, /:root:root,:root:root\[data-theme='light'\]\{/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:root:not\(\[data-theme='light'\]\)\{/);
  assert.match(css, /:root:root\[data-theme='dark'\]\{/);
  // The explicit toggle must come last so it beats the OS media query.
  assert.ok(css.lastIndexOf(":root:root[data-theme='dark']") > css.indexOf('@media'));
});

test('brandPresetCss: carries the preset values and closes every block', () => {
  const preset = resolveBrandPreset('sitelines');
  const css = brandPresetCss(preset);
  assert.ok(css.includes(`--brand:${preset.light['--brand']!};`));
  assert.ok(css.includes(`--brand:${preset.dark['--brand']!};`));
  assert.equal((css.match(/\{/g) ?? []).length, (css.match(/\}/g) ?? []).length);
});

test('brandPresetCss: no preset value can break out of the style block', () => {
  for (const preset of BRAND_PRESETS) {
    for (const vars of [preset.light, preset.dark]) {
      for (const [key, value] of Object.entries(vars)) {
        assert.ok(!/[<>{}]/.test(value), `${preset.id} ${key} contains a CSS/HTML delimiter`);
      }
    }
  }
});
