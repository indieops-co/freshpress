import { describe, it, expect } from 'vitest';
import {
  buildFullPostText,
  buildHashtagLine,
  slugifyTag,
  PLATFORM_LIMITS,
} from '../content/social-types.js';
import type { SocialPlatform } from '../content/social-types.js';
import { extractBlogSections, pickNextSection } from '../social/sections.js';
import { buildSocialBatchPrompt } from './generate.js';
import { composeStyleContext } from '../design/design-excellence.js';

describe('social-types', () => {
  it('slugifyTag strips hash and spaces', () => {
    expect(slugifyTag('#Hello World')).toBe('HelloWorld');
    expect(slugifyTag('  foo-bar  ')).toBe('foobar');
  });

  it('buildHashtagLine joins tags', () => {
    expect(buildHashtagLine(['one', 'two'])).toBe('#one #two');
    expect(buildHashtagLine(['SEO tips', 'content'])).toBe('#SEOtips #content');
  });

  it('buildFullPostText combines caption and hashtags', () => {
    expect(buildFullPostText('Hello world', ['tag1'])).toBe('Hello world\n\n#tag1');
    expect(buildFullPostText('Caption only', [])).toBe('Caption only');
  });

  it('platform char limits are defined', () => {
    expect(PLATFORM_LIMITS.x.maxChars).toBe(280);
    expect(PLATFORM_LIMITS.linkedin.maxChars).toBe(3000);
    expect(PLATFORM_LIMITS.facebook.warnAt).toBe(500);
  });
});

describe('section rotation', () => {
  const sections = [
    { slug: 'intro', heading: 'Intro', excerpt: 'First' },
    { slug: 'benefits', heading: 'Benefits', excerpt: 'Second' },
    { slug: 'faq', heading: 'FAQ', excerpt: 'Third' },
  ];

  it('picks unused section first', () => {
    const pick = pickNextSection(sections, { runCount: 1, usedSections: ['intro'] });
    expect(pick.section.slug).toBe('benefits');
    expect(pick.overlap).toBe(false);
  });

  it('allows overlap when all sections used', () => {
    const pick = pickNextSection(sections, {
      runCount: 3,
      usedSections: ['intro', 'benefits', 'faq'],
    });
    expect(pick.overlap).toBe(true);
    expect(pick.section).toBeDefined();
  });

  it('extractBlogSections from HTML', () => {
    const html = '<h2>First</h2><p>Para one.</p><h3>Second</h3><p>Para two.</p>';
    const out = extractBlogSections(html);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].heading).toBe('First');
  });
});

describe('buildSocialBatchPrompt', () => {
  const base = {
    post: { title: 'How to Prune Roses', keyword: 'rose pruning' },
    section: { heading: 'Timing matters', excerpt: 'Prune in late winter before bud break.' },
    outline: '- Timing matters: Prune in late winter before bud break.',
    usedList: 'none',
    generationRun: 1,
    platforms: ['linkedin', 'x'] as SocialPlatform[],
    brandContext: '## Brand voice\nNo corporate jargon.',
  };

  it('includes the design rules block when the guide has designRules', () => {
    const prompt = buildSocialBatchPrompt({
      ...base,
      styleContext: composeStyleContext({
        aiSystemPromptAddition: 'Adopt the Vercel aesthetic: monochrome precision.',
        designRules: "### Don't\n- Never add a sixth accent color",
      }),
    });

    expect(prompt).toContain('Adopt the Vercel aesthetic: monochrome precision.');
    expect(prompt).toContain("Design rules for this brand (follow the Do's, avoid the Don'ts):");
    expect(prompt).toContain('Never add a sixth accent color');
    expect(prompt).toContain('LinkedIn: max 3000 chars');
    expect(prompt).toContain('No corporate jargon.');
  });

  it('omits the style block entirely when the site has no guide', () => {
    const prompt = buildSocialBatchPrompt(base);

    expect(prompt).not.toContain('Brand style context');
    expect(prompt).not.toContain('Design rules for this brand');
    expect(prompt).toContain('How to Prune Roses');
    expect(prompt).toContain('X/Twitter: max 280 chars');
  });

  it('carries the prompt addition but no rules block when designRules is empty', () => {
    const prompt = buildSocialBatchPrompt({
      ...base,
      styleContext: composeStyleContext({
        aiSystemPromptAddition: 'Adopt the Vercel aesthetic: monochrome precision.',
        designRules: '',
      }),
    });

    expect(prompt).toContain('Adopt the Vercel aesthetic: monochrome precision.');
    expect(prompt).not.toContain('Design rules for this brand');
  });
});
