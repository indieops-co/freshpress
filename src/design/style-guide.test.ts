import { describe, expect, it } from 'vitest';
import { buildDefaultStyleGuide, generateCssVariables, generateStyleSheet, StyleGuideSchema } from './style-guide.js';

const guide = buildDefaultStyleGuide('test', 'Test Theme', 'Testing Aesthetic');

describe('generateCssVariables', () => {
  it('covers the full color set, not just the legacy subset', () => {
    const css = generateCssVariables(guide);
    for (const name of [
      '--fp-primary',
      '--fp-secondary',
      '--fp-accent',
      '--fp-bg',
      '--fp-surface',
      '--fp-surface-strong',
      '--fp-text',
      '--fp-text-muted',
      '--fp-text-inverse',
      '--fp-border',
      '--fp-success',
      '--fp-warning',
      '--fp-error',
    ]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('emits spacing, radii, shadows, fonts, and motion tokens', () => {
    const css = generateCssVariables(guide);
    for (const name of [
      '--fp-space-xs',
      '--fp-space-section',
      '--fp-container',
      '--fp-gutter',
      '--fp-radius-sm',
      '--fp-radius-pill',
      '--fp-shadow-lg',
      '--fp-shadow-glow',
      '--fp-font-heading',
      '--fp-font-body',
      '--fp-font-mono',
      '--fp-duration',
      '--fp-easing',
    ]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('emits sanitized custom color variables', () => {
    const withCustom = {
      ...guide,
      colors: { ...guide.colors, custom: { 'Brand Glow': '#ff00ff' } },
    };
    expect(generateCssVariables(withCustom)).toContain('--fp-custom-brand-glow: #ff00ff;');
  });
});

describe('generateStyleSheet', () => {
  const sheet = generateStyleSheet(guide);

  it('includes the variables block', () => {
    expect(sheet).toContain(':root {');
    expect(sheet).toContain('--fp-primary:');
  });

  it('emits the full typography scale as semantic classes', () => {
    for (const cls of [
      '.fp-display-lg',
      '.fp-display-md',
      '.fp-h1',
      '.fp-h2',
      '.fp-h3',
      '.fp-h4',
      '.fp-body-lg',
      '.fp-body',
      '.fp-body-sm',
      '.fp-caption',
      '.fp-label',
    ]) {
      expect(sheet).toContain(`${cls} {`);
    }
  });

  it('emits component classes from component tokens', () => {
    expect(sheet).toContain('.fp-btn-primary');
    expect(sheet).toContain('.fp-btn-secondary');
    expect(sheet).toContain('.fp-card {');
    expect(sheet).toContain('.fp-nav {');
    expect(sheet).toContain('.fp-hero {');
    expect(sheet).toContain('.fp-footer {');
    expect(sheet).toContain('.fp-section {');
    expect(sheet).toContain('.fp-container {');
    expect(sheet).toContain(`background: ${guide.components.button.primaryBg}`);
    expect(sheet).toContain(`border-radius: ${guide.components.button.primaryRadius}`);
  });

  it('scopes tag-level rules under .fp-page for legacy templates', () => {
    expect(sheet).toContain('.fp-page h1 {');
    expect(sheet).toContain('.fp-page p, .fp-page li {');
    expect(sheet).toContain('.fp-page a {');
    expect(sheet).toContain('.fp-page img {');
  });

  it('carries scale values into the classes', () => {
    expect(sheet).toContain(`font-size: ${guide.typography.scale.h1.size}`);
    expect(sheet).toContain(`font-size: ${guide.typography.scale.displayLg.size}`);
  });

  it('omits transitions when motion style is none', () => {
    const still = { ...guide, motion: { ...guide.motion, style: 'none' as const } };
    expect(generateStyleSheet(still)).not.toContain('transition:');
    expect(sheet).toContain('transition:');
  });
});

describe('StyleGuideSchema — designRules backfill', () => {
  // The store re-parses every read/write, so a legacy guide persisted before
  // the field existed must parse cleanly and gain the empty default.
  it('parses a legacy guide without designRules to an empty string', () => {
    const { designRules: _dropped, ...legacy } = buildDefaultStyleGuide('legacy', 'Legacy', 'Old');
    const parsed = StyleGuideSchema.parse(legacy);
    expect(parsed.designRules).toBe('');
  });
});

describe('StyleGuideSchema — logo (optional pointer)', () => {
  it('parses guides without a logo unchanged (every pre-existing stored guide)', () => {
    const parsed = StyleGuideSchema.parse(buildDefaultStyleGuide('t', 'T', 'a'));
    expect(parsed.logo).toBeUndefined();
  });

  it('accepts a logo url and defaults alt to empty', () => {
    const withLogo = { ...buildDefaultStyleGuide('t', 'T', 'a'), logo: { url: '/media/site1/wp-content/uploads/logo.svg' } };
    const parsed = StyleGuideSchema.parse(withLogo);
    expect(parsed.logo?.url).toBe('/media/site1/wp-content/uploads/logo.svg');
    expect(parsed.logo?.alt).toBe('');
  });
});
