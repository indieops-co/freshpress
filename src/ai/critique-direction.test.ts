import { describe, it, expect } from 'vitest';
import {
  buildCritiquePrompt,
  extractDirectionCopy,
  parseCritique,
} from './critique-direction.js';
import type { PageContent } from '../content/types.js';

const content: PageContent = {
  template: '<h1>{{slot:h1}}</h1><p>{{slot:p1}}</p>',
  slots: {
    h1: { id: 'h1', type: 'text', value: 'Plumbing that shows up on time', tag: 'h1', path: 'h1[0]' },
    p1: { id: 'p1', type: 'text', value: 'Serving the metro since 1998.', tag: 'p', path: 'p[0]' },
  },
  slotOrder: ['h1', 'p1'],
};

const direction = {
  directive: 'the most complete layout for this business',
  fingerprint: ['hero', 'services', 'footer'],
  page: { content },
};

describe('extractDirectionCopy', () => {
  it('lists slot copy in slot order as tag: value lines', () => {
    const copy = extractDirectionCopy(content);
    expect(copy).toBe('h1: Plumbing that shows up on time\np: Serving the metro since 1998.');
  });

  it('appends slots a stale slotOrder misses instead of dropping them', () => {
    const stale: PageContent = {
      ...content,
      slots: {
        ...content.slots,
        extra: { id: 'extra', type: 'text', value: 'Emergency call-outs 24/7.', tag: 'p', path: 'p[9]' },
      },
      slotOrder: ['h1'],
    };
    const copy = extractDirectionCopy(stale);
    expect(copy).toContain('Plumbing that shows up on time');
    expect(copy).toContain('Emergency call-outs 24/7.');
  });

  it('caps long copy at a line boundary', () => {
    const long: PageContent = {
      ...content,
      slots: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [
          `s${i}`,
          { id: `s${i}`, type: 'text' as const, value: 'x'.repeat(60), tag: 'p', path: `p[${i}]` },
        ])
      ),
      slotOrder: Array.from({ length: 200 }, (_, i) => `s${i}`),
    };
    const copy = extractDirectionCopy(long);
    expect(copy.length).toBeLessThanOrEqual(3500);
    expect(copy.endsWith('x'.repeat(60))).toBe(true);
  });
});

describe('buildCritiquePrompt', () => {
  it('includes the brand design rules block when designRules is set', () => {
    const { system, user } = buildCritiquePrompt({
      direction,
      designRules: "### Don't\n- Never add a sixth accent color",
      aesthetic: 'monochrome precision',
    });
    expect(user).toContain("Design rules for this brand (follow the Do's, avoid the Don'ts):");
    expect(user).toContain('Never add a sixth accent color');
    expect(user).toContain('monochrome precision');
    expect(user).toContain('hero → services → footer');
    expect(user).toContain('Plumbing that shows up on time');
    expect(system).toContain('slopScore');
  });

  it('omits the rules block when designRules is empty or absent', () => {
    const { user } = buildCritiquePrompt({ direction, designRules: '', aesthetic: 'minimal' });
    expect(user).not.toContain('Design rules for this brand');
    const { user: user2 } = buildCritiquePrompt({ direction, aesthetic: 'minimal' });
    expect(user2).not.toContain('Design rules for this brand');
  });
});

describe('parseCritique', () => {
  it('parses a clean JSON response', () => {
    const critique = parseCritique(
      '{"slopScore": 3, "verdict": "Distinct opener, solid hierarchy.", "issues": ["CTA says Submit"]}'
    );
    expect(critique).toEqual({
      slopScore: 3,
      verdict: 'Distinct opener, solid hierarchy.',
      issues: ['CTA says Submit'],
    });
  });

  it('accepts JSON wrapped in fences or prose', () => {
    const critique = parseCritique(
      'Here is my review:\n```json\n{"slopScore": 8, "verdict": "Reads generic.", "issues": []}\n```'
    );
    expect(critique?.slopScore).toBe(8);
    expect(critique?.issues).toEqual([]);
  });

  it('survives trailing prose containing braces after the JSON object', () => {
    const critique = parseCritique(
      '{"slopScore": 4, "verdict": "Solid.", "issues": []}\n\nNote: the {brand} placeholder pattern is fine.'
    );
    expect(critique?.slopScore).toBe(4);
  });

  it('rejects a null or missing slopScore instead of grading it as 1', () => {
    expect(parseCritique('{"slopScore": null, "verdict": "Reads fully generic.", "issues": []}')).toBeNull();
    expect(parseCritique('{"slopScore": true, "verdict": "v", "issues": []}')).toBeNull();
  });

  it('clamps slopScore into 1-10 and rounds', () => {
    expect(parseCritique('{"slopScore": 0, "verdict": "v", "issues": []}')?.slopScore).toBe(1);
    expect(parseCritique('{"slopScore": 42, "verdict": "v", "issues": []}')?.slopScore).toBe(10);
    expect(parseCritique('{"slopScore": 6.6, "verdict": "v", "issues": []}')?.slopScore).toBe(7);
  });

  it('returns null on malformed input instead of throwing', () => {
    expect(parseCritique('not json at all')).toBeNull();
    expect(parseCritique('{"slopScore": "high", "verdict": ""}')).toBeNull();
    expect(parseCritique('{"verdict": "no score"}')).toBeNull();
    expect(parseCritique('{broken json')).toBeNull();
  });

  it('coerces non-string issues away rather than failing', () => {
    const critique = parseCritique('{"slopScore": 5, "verdict": "ok", "issues": ["real", 7, null, ""]}');
    expect(critique?.issues).toEqual(['real']);
  });
});
