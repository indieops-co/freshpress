import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../ai/chat.js';
import { composeStyleContext } from '../design/design-excellence.js';
import type { PageContent } from '../content/types.js';

const content: PageContent = {
  template: '<h1>{{slot:a}}</h1>',
  slots: {
    a: { id: 'a', type: 'text', value: 'Hello', tag: 'h1', path: 'h1[0]' },
  },
  slotOrder: ['a'],
};

describe('buildUserPrompt', () => {
  it('includes slot list and user message', () => {
    const prompt = buildUserPrompt({ message: 'Make it say Welcome', content, pageTitle: 'Home' });
    expect(prompt).toContain('Hello');
    expect(prompt).toContain('Make it say Welcome');
    expect(prompt).toContain('a (text');
  });

  it('restricts the slot list to the scoped element subtree', () => {
    const scopedContent: PageContent = {
      template: '<h1>{{slot:a}}</h1><p>{{slot:b}}</p>',
      slots: {
        a: { id: 'a', type: 'text', value: 'Hello', tag: 'h1', path: 'h1[0]' },
        b: { id: 'b', type: 'text', value: 'Outside scope', tag: 'p', path: 'p[0]' },
      },
      slotOrder: ['a', 'b'],
    };
    const prompt = buildUserPrompt({
      message: 'Change the heading',
      content: scopedContent,
      pageTitle: 'Home',
      scope: {
        elementId: 'HeroSection-1-p1',
        elementType: 'HeroSection',
        slotIds: ['a'],
        styleTokens: { padding: [], margin: [], radius: [], shadow: [], color: [] },
      },
    });
    expect(prompt).toContain('Hello');
    expect(prompt).not.toContain('Outside scope');
  });
});

describe('buildSystemPrompt', () => {
  it('always carries the microcopy discipline', () => {
    expect(buildSystemPrompt()).toContain('Save changes');
  });

  it('includes both the design direction and the brand design rules via composeStyleContext', () => {
    const styleContext = composeStyleContext({
      aiSystemPromptAddition: 'Adopt the Vercel aesthetic.',
      designRules: "### Don't\n- No sixth accent",
    });
    const prompt = buildSystemPrompt(styleContext);
    expect(prompt).toContain('Site design direction:');
    expect(prompt).toContain('Adopt the Vercel aesthetic.');
    expect(prompt).toContain("Design rules for this brand (follow the Do's, avoid the Don'ts):");
    expect(prompt).toContain('No sixth accent');
  });

  it('adds no rules header when the guide has no design rules', () => {
    const prompt = buildSystemPrompt(
      composeStyleContext({ aiSystemPromptAddition: 'Adopt the X aesthetic.', designRules: '' })
    );
    expect(prompt).toContain('Adopt the X aesthetic.');
    expect(prompt).not.toContain('Design rules for this brand');
  });
});
