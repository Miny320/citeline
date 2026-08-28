import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * WCAG AA contrast audit of the design tokens.
 *
 * Colour contrast is one of the few visual properties that can be checked objectively, so it
 * is checked rather than eyeballed. This caught a real failure: `--subtle`, used for hints,
 * timestamps and footers throughout, sat at 2.73:1 in light mode against a 4.5:1 requirement.
 */

const CSS = readFileSync('app/globals.css', 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, name, value] = match;
    if (name && value) out[name] = value;
  }
  return out;
}

const LIGHT = tokens(CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@media')));
const DARK_BLOCK = CSS.slice(CSS.indexOf('@media (prefers-color-scheme: dark)'));
const DARK = tokens(DARK_BLOCK.slice(0, DARK_BLOCK.indexOf('@theme')));

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every foreground/background pairing the UI actually renders. */
const PAIRS: Array<[fg: string, bg: string, label: string]> = [
  ['foreground', 'background', 'body text'],
  ['foreground', 'surface', 'text on cards'],
  ['muted', 'background', 'secondary text'],
  ['muted', 'surface', 'secondary text on cards'],
  ['muted', 'surface-muted', 'text on muted panels'],
  ['subtle', 'background', 'hints and timestamps'],
  ['subtle', 'surface', 'hints on cards'],
  ['subtle', 'surface-muted', 'hints on muted panels'],
  ['accent', 'accent-soft', 'citation chip'],
  ['accent', 'background', 'accent text'],
  ['accent-foreground', 'accent', 'primary button label'],
  ['danger', 'danger-soft', 'error text'],
  ['warning', 'warning-soft', 'warning text'],
];

const AA_NORMAL_TEXT = 4.5;

for (const [themeName, theme] of [
  ['light', LIGHT],
  ['dark', DARK],
] as const) {
  describe(`contrast — ${themeName} theme`, () => {
    it('defines every token the UI pairs', () => {
      for (const [fg, bg] of PAIRS) {
        assert.ok(theme[fg], `--${fg} is not defined in the ${themeName} palette`);
        assert.ok(theme[bg], `--${bg} is not defined in the ${themeName} palette`);
      }
    });

    for (const [fg, bg, label] of PAIRS) {
      it(`${label} meets WCAG AA`, () => {
        const foreground = theme[fg];
        const background = theme[bg];
        assert.ok(foreground && background);

        const ratio = contrast(foreground, background);
        assert.ok(
          ratio >= AA_NORMAL_TEXT,
          `${label} (--${fg} on --${bg}) is ${ratio.toFixed(2)}:1, needs ${AA_NORMAL_TEXT}:1`,
        );
      });
    }
  });
}

describe('focus visibility', () => {
  it('defines a focus-visible outline', () => {
    // Without this, keyboard users have no indication of where they are.
    assert.match(CSS, /:focus-visible\s*\{[^}]*outline:/, 'no :focus-visible outline defined');
  });

  it('respects prefers-reduced-motion', () => {
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  });
});
