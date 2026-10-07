import { describe, it, expect } from 'vitest';
import { sanitizeStyleGuideTokens, FORBIDDEN_CSS_TOKEN } from './sanitize-style-guide.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';

const base = () => buildDefaultStyleGuide('test', 'Test Theme', 'Testing Aesthetic');

/**
 * The store-choke-point sweep: apply/generate persist free-form token values
 * (parsed DESIGN.md / AI output) that generateStyleSheet interpolates into a
 * served <style> with only `<` escaped — url()/@import/expression() must be
 * blanked before save, without touching legitimate values or prose fields.
 */
describe('sanitizeStyleGuideTokens', () => {
  it('blanks url()/@import/expression() in interpolated token values and warns per hit', () => {
    const guide = base();
    guide.colors.primary = 'url(https://evil.test/px)';
    guide.colors.custom['brand-glow'] = '@import "https://evil.test/x.css"';
    guide.shadows.md = 'expression(alert(1))';
    guide.typography.headingFont = 'url(javascript:1)';
    guide.spacing.md = '1rem url(//evil)';
    guide.components.button.primaryBg = 'URL (https://evil.test)'; // spaced + cased

    const { guide: clean, warnings } = sanitizeStyleGuideTokens(guide);
    expect(clean.colors.primary).toBe('');
    expect(clean.colors.custom['brand-glow']).toBe('');
    expect(clean.shadows.md).toBe('');
    expect(clean.typography.headingFont).toBe('');
    expect(clean.spacing.md).toBe('');
    expect(clean.components.button.primaryBg).toBe('');
    expect(warnings).toHaveLength(6);
    // Pure: the input guide is untouched.
    expect(guide.colors.primary).toBe('url(https://evil.test/px)');
  });

  it('leaves legitimate values alone — rgba shadows, quoted font stacks, calc/var', () => {
    const guide = base();
    guide.shadows.md = '0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0,0,0,0.04)';
    guide.typography.headingFont = '"GT Walsheim", "Helvetica Neue", sans-serif';
    guide.spacing.container = 'min(1200px, calc(100vw - 2rem))';
    guide.motion.defaultEasing = 'cubic-bezier(0.22, 1, 0.36, 1)';

    const { guide: clean, warnings } = sanitizeStyleGuideTokens(guide);
    expect(warnings).toEqual([]);
    expect(clean).toBe(guide); // no changes → same reference, no clone churn
  });

  it('never touches prose fields or customCss (where url() is legal and separately validated)', () => {
    const guide = base();
    guide.customCss = '.fp-page .hero { background-image: url(https://cdn.example.com/hero.jpg); }';
    guide.designRules = "Don't use url() backgrounds in buttons.";
    guide.aiSystemPromptAddition = 'Reference: https://example.com/brand — avoid @import-style shortcuts.';
    guide.components.button.ctaStyle = 'Rounded url-safe pill with high contrast';

    const { guide: clean, warnings } = sanitizeStyleGuideTokens(guide);
    expect(warnings).toEqual([]);
    expect(clean.customCss).toBe(guide.customCss);
    expect(clean.designRules).toBe(guide.designRules);
  });

  it('the default guide round-trips unchanged with zero warnings', () => {
    const guide = base();
    // Snapshot the pristine input (same object) rather than comparing to a second
    // base() call: buildDefaultStyleGuide stamps meta.createdAt with new Date(), so
    // two calls can differ by a millisecond under load and fail the deep-equal.
    const before = JSON.parse(JSON.stringify(guide));
    const { guide: clean, warnings } = sanitizeStyleGuideTokens(guide);
    expect(warnings).toEqual([]);
    expect(clean).toEqual(before);
  });

  it('FORBIDDEN_CSS_TOKEN matches the three vectors and nothing benign', () => {
    for (const bad of ['url(x)', 'url (x)', '@import "x"', 'expression(alert(1))', 'expression (x)']) {
      expect(FORBIDDEN_CSS_TOKEN.test(bad)).toBe(true);
    }
    for (const ok of ['rgba(0,0,0,0.5)', 'cubic-bezier(0.2, 1, 0.3, 1)', '"Sohne", sans-serif', '#533AFD', 'important']) {
      expect(FORBIDDEN_CSS_TOKEN.test(ok)).toBe(false);
    }
  });
});
