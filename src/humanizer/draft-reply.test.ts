import { describe, it, expect } from 'vitest';
import { toParagraphHtml, buildDraftReplySystemPrompt } from './draft-reply.js';
import type { HumanizerSiteConfig } from './types.js';

describe('toParagraphHtml', () => {
  it('wraps blank-line-separated paragraphs in <p> tags', () => {
    expect(toParagraphHtml('First paragraph.\n\nSecond paragraph.')).toBe(
      '<p>First paragraph.</p><p>Second paragraph.</p>'
    );
  });

  it('converts single newlines within a paragraph to <br>', () => {
    expect(toParagraphHtml('Line one\nLine two')).toBe('<p>Line one<br>Line two</p>');
  });

  it('escapes HTML-significant characters', () => {
    expect(toParagraphHtml('Use < and > and & carefully')).toBe('<p>Use &lt; and &gt; and &amp; carefully</p>');
  });

  it('returns an empty paragraph for blank input', () => {
    expect(toParagraphHtml('   ')).toBe('<p></p>');
  });
});

function makeConfig(overrides: Partial<HumanizerSiteConfig> = {}): HumanizerSiteConfig {
  return {
    siteId: 'site1',
    mode: 'skill',
    tone: 'friendly-professional',
    readingLevel: "Bachelor's degree in liberal arts",
    contentTypeHint: 'auto',
    autoDraftEnabled: true,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildDraftReplySystemPrompt', () => {
  it('includes tone and reading level', () => {
    const prompt = buildDraftReplySystemPrompt(makeConfig());
    expect(prompt).toContain('friendly-professional');
    expect(prompt).toContain("Bachelor's degree in liberal arts");
  });

  it('prefers emailReplySkill samples over the general voiceSample', () => {
    const prompt = buildDraftReplySystemPrompt(
      makeConfig({
        voiceSample: 'General voice sample text.',
        emailReplySkill: {
          samples: [{ id: 's1', text: 'Email-specific sample text.', addedAt: '2026-01-01T00:00:00Z' }],
          neverPhrases: [],
        },
      })
    );
    expect(prompt).toContain('Email-specific sample text.');
    expect(prompt).not.toContain('General voice sample text.');
  });

  it('falls back to voiceSample when no email-specific samples exist yet', () => {
    const prompt = buildDraftReplySystemPrompt(
      makeConfig({ voiceSample: 'General voice sample text.', emailReplySkill: { samples: [], neverPhrases: [] } })
    );
    expect(prompt).toContain('General voice sample text.');
  });

  it('includes never-say phrases', () => {
    const prompt = buildDraftReplySystemPrompt(
      makeConfig({ emailReplySkill: { samples: [], neverPhrases: ['circle back', 'per my last email'] } })
    );
    expect(prompt).toContain('circle back');
    expect(prompt).toContain('per my last email');
  });

  it('includes customAugment when present', () => {
    const prompt = buildDraftReplySystemPrompt(makeConfig({ customAugment: 'Always mention our 30-day guarantee.' }));
    expect(prompt).toContain('Always mention our 30-day guarantee.');
  });
});
