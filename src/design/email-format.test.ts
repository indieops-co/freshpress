import { describe, it, expect } from 'vitest';
import { buildDefaultStyleGuide } from './style-guide.js';
import { EmailFormatSchema, deriveEmailFormatFromStyleGuide, buildBlankEmailFormat } from './email-format.js';

describe('EmailFormat schema', () => {
  it('parses a blank format', () => {
    const format = buildBlankEmailFormat('site1', 'ef_1');
    expect(() => EmailFormatSchema.parse(format)).not.toThrow();
    expect(format.provenance.source).toBe('manual');
    expect(format.provenance.customized).toBe(false);
  });
});

describe('deriveEmailFormatFromStyleGuide', () => {
  const guide = buildDefaultStyleGuide('stripe', 'Stripe', 'Clean, confident, developer-first');

  it('maps colors, typography, and spacing 1:1 from the StyleGuide', () => {
    const format = deriveEmailFormatFromStyleGuide(guide, 'site1');
    expect(format.colors.primary).toBe(guide.colors.primary);
    expect(format.colors.background).toBe(guide.colors.background);
    expect(format.spacing.gutter).toBe(guide.spacing.gutter);
    expect(format.spacing.paragraphGap).toBe(guide.spacing.md);
    expect(format.spacing.sectionGap).toBe(guide.spacing.lg);
    expect(format.button.background).toBe(guide.components.button.primaryBg);
  });

  it('sets style-guide-sync provenance, not customized', () => {
    const format = deriveEmailFormatFromStyleGuide(guide, 'site1');
    expect(format.provenance.source).toBe('style-guide-sync');
    expect(format.provenance.sourceRef).toBe(guide.meta.id);
    expect(format.provenance.customized).toBe(false);
  });

  it('drops web-only concepts (no radii/shadows/motion fields leak through)', () => {
    const format = deriveEmailFormatFromStyleGuide(guide, 'site1');
    expect(format).not.toHaveProperty('radii');
    expect(format).not.toHaveProperty('shadows');
    expect(format).not.toHaveProperty('motion');
  });

  it('produces a valid EmailFormat every time (schema round-trips)', () => {
    const format = deriveEmailFormatFromStyleGuide(guide, 'site1');
    expect(() => EmailFormatSchema.parse(format)).not.toThrow();
  });
});
