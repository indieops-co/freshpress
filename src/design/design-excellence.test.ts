import { describe, it, expect } from 'vitest';
import {
  ANTI_SLOP_BLOCKLIST,
  AESTHETIC_RISK,
  PALETTE_DISCIPLINE,
  SIGNATURE_ELEMENT,
  CONFLICT_RESOLUTION,
  QUALITY_FLOOR,
  MICROCOPY_RULES,
  designMdAuthoringExcellence,
  copyExcellence,
  composeStyleContext,
  DESIGN_RULES_MAX_CHARS,
} from './design-excellence.js';

const ALL_FRAGMENTS = {
  ANTI_SLOP_BLOCKLIST,
  AESTHETIC_RISK,
  PALETTE_DISCIPLINE,
  SIGNATURE_ELEMENT,
  CONFLICT_RESOLUTION,
  QUALITY_FLOOR,
  MICROCOPY_RULES,
};

describe('design-excellence fragments', () => {
  it('every fragment is non-empty and trimmed', () => {
    for (const [name, value] of Object.entries(ALL_FRAGMENTS)) {
      expect(value.length, name).toBeGreaterThan(0);
      expect(value, name).toBe(value.trim());
    }
  });

  // Fragments are interpolated into prompt template literals downstream; a
  // literal "${" in one would read as an injection seam even though these are
  // plain strings — keep them free of it.
  it('no fragment contains template-literal syntax', () => {
    for (const [name, value] of Object.entries(ALL_FRAGMENTS)) {
      expect(value.includes('${'), name).toBe(false);
    }
  });

  it('the conflict-resolution hierarchy keeps the brief first and accessibility non-negotiable', () => {
    expect(CONFLICT_RESOLUTION).toMatch(/brand's own stated inputs always win/i);
    expect(CONFLICT_RESOLUTION).toMatch(/accessibility is non-negotiable/i);
  });
});

describe('per-consumer assemblers', () => {
  it('authoring set carries the full aesthetic guidance within budget', () => {
    const text = designMdAuthoringExcellence();
    expect(text.length).toBeLessThanOrEqual(4000);
    for (const fragment of [
      AESTHETIC_RISK,
      ANTI_SLOP_BLOCKLIST,
      PALETTE_DISCIPLINE,
      SIGNATURE_ELEMENT,
      CONFLICT_RESOLUTION,
      QUALITY_FLOOR,
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it('copy subset is microcopy-only and small', () => {
    const text = copyExcellence();
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toContain('Save changes');
    expect(text).not.toContain(ANTI_SLOP_BLOCKLIST);
  });
});

describe('composeStyleContext', () => {
  it('returns just the prompt addition when there are no design rules', () => {
    const out = composeStyleContext({ aiSystemPromptAddition: 'Adopt the X aesthetic.', designRules: '' });
    expect(out).toBe('Adopt the X aesthetic.');
    expect(out).not.toContain('Design rules');
  });

  it('appends a labeled rules block when rules exist', () => {
    const out = composeStyleContext({
      aiSystemPromptAddition: 'Adopt the X aesthetic.',
      designRules: "### Do\n- Reserve black for CTAs\n### Don't\n- No sixth accent",
    });
    expect(out).toContain('Adopt the X aesthetic.');
    expect(out).toContain("Design rules for this brand (follow the Do's, avoid the Don'ts):");
    expect(out).toContain('No sixth accent');
  });

  it('re-caps oversized rules defensively', () => {
    const out = composeStyleContext({
      aiSystemPromptAddition: 'Base.',
      designRules: 'x'.repeat(DESIGN_RULES_MAX_CHARS + 500),
    });
    expect(out.length).toBeLessThanOrEqual('Base.'.length + 100 + DESIGN_RULES_MAX_CHARS);
  });
});
