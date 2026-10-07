import { describe, it, expect } from 'vitest';
import { buildDesignMdSystemPrompt } from './generate-design-md.js';

describe('buildDesignMdSystemPrompt', () => {
  const prompt = buildDesignMdSystemPrompt();

  it('keeps the full 9-section DESIGN.md skeleton', () => {
    for (const marker of [
      '## 1. Visual Theme & Atmosphere',
      '## 2. Color Palette & Roles',
      '## 3. Typography Rules',
      '## 4. Component Styling',
      '## 5. Layout Principles',
      '## 6. Depth & Elevation',
      "## 7. Do's and Don'ts",
      '## 8. Responsive Behavior',
      '## 9. Agent Prompt Guide',
      'Output ONLY the DESIGN.md markdown',
    ]) {
      expect(prompt).toContain(marker);
    }
  });

  it('injects the design-excellence fundamentals', () => {
    expect(prompt).toContain('Design-excellence fundamentals');
    // anti-slop marker
    expect(prompt).toContain('cream background');
    // palette discipline marker
    expect(prompt).toContain('3-5 colors');
    // signature element carried into the skeleton's section instructions
    expect(prompt).toContain('signature visual element');
  });

  it('states that the brief always wins over the fundamentals', () => {
    expect(prompt).toMatch(/brand's own stated inputs .* always win/i);
  });

  it("asks for brand-specific Do's/Don'ts guardrails (what extractDesignRules harvests)", () => {
    expect(prompt).toContain('5–8 guardrails specific to THIS brand');
  });

  it('stays within its token budget and carries no unresolved interpolation', () => {
    expect(prompt.length).toBeLessThanOrEqual(8000);
    expect(prompt).not.toContain('${');
  });
});
