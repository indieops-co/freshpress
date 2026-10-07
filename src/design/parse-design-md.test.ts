import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDesignRules, parseDesignMdHeuristic } from './parse-design-md.js';
import { DESIGN_RULES_MAX_CHARS } from './design-excellence.js';

// Real vendored corpus file — the rules sections sit past the 12k-char slice
// the AI parse pass reads, which is the whole reason extraction is deterministic.
const vercelRaw = readFileSync(join(__dirname, 'design-md', 'vercel.md'), 'utf8');

describe('parseDesignMdHeuristic', () => {
  it('extracts colors and fonts from DESIGN.md-like content', () => {
    const raw = `# Vercel\nPrimary: #000000\nAccent: #0070f3\nFont: Geist, Inter`;
    const guide = parseDesignMdHeuristic(raw, 'vercel', 'Vercel', 'Minimalist');
    expect(guide.colors.primary).toBe('#000000');
    expect(guide.meta.sourceRef).toBe('vercel');
    expect(guide.cssVariables).toContain('--fp-primary');
  });

  // Regression coverage for a real bug: the previous font-extraction regex matched
  // any loose "font"/"Font" word followed by whitespace, so real awesome-design-md
  // files (which use a YAML `fontFamily:` key, and separately have prose headings
  // like "### Font Family" / "### Note on Font Substitutes") produced garbage
  // font names ("Family", "Substitutes") instead of the real font stacks, and never
  // matched the actual `fontFamily:` values at all (no hyphen, no space before the
  // colon — the old regex required one or the other).
  it('extracts real font names from an actual awesome-design-md-shaped document, ignoring prose headings', () => {
    const raw = `---
name: Vercel-inspired
colors:
  primary: "#171717"
typography:
  display-xl:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 48px
  body-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 16px
  code:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, monospace
    fontSize: 13px
---

## Typography

### Font Family
Two custom faces carry the entire system.

### Note on Font Substitutes
The two primary faces are proprietary. Open-source substitutes: Inter, JetBrains Mono.
`;
    const guide = parseDesignMdHeuristic(raw, 'vercel', 'Vercel', 'Minimalist');
    expect(guide.typography.headingFont).toBe('Geist');
    expect(guide.typography.bodyFont).toBe('Geist');
    expect(guide.typography.monoFont).toBe('Geist Mono');
    expect(guide.typography.headingFont).not.toBe('Family');
    expect(guide.typography.bodyFont).not.toBe('Substitutes');
  });

  it('picks distinct heading vs. body fonts when the document declares two, quoted, comma-separated stacks', () => {
    const raw = `---
typography:
  display-xl:
    fontFamily: "Copernicus, Tiempos Headline, serif"
  body-md:
    fontFamily: "StyreneB, Inter, sans-serif"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
---
`;
    const guide = parseDesignMdHeuristic(raw, 'claude', 'Claude', 'Warm editorial');
    expect(guide.typography.headingFont).toBe('Copernicus');
    expect(guide.typography.bodyFont).toBe('StyreneB');
    expect(guide.typography.monoFont).toBe('JetBrains Mono');
  });

  it('handles a nested single-quoted segment inside a double-quoted fontFamily value', () => {
    const raw = `typography:\n  display-xl:\n    fontFamily: "sohne-var, 'SF Pro Display', system-ui, sans-serif"\n`;
    const guide = parseDesignMdHeuristic(raw, 'stripe', 'Stripe', 'Confident');
    expect(guide.typography.headingFont).toBe('sohne-var');
  });

  it('populates designRules from a real vendored DESIGN.md', () => {
    const guide = parseDesignMdHeuristic(vercelRaw, 'vercel', 'Vercel', 'Minimalist');
    expect(guide.designRules).toContain('sixth accent');
  });
});

describe('extractDesignRules', () => {
  it("extracts the Do's and Don'ts section from a real vendored file, past the AI parser's 12k slice", () => {
    // Guard the premise: if the corpus is ever re-vendored with rules earlier
    // in the file, this extraction path stops being the only carry-through.
    expect(vercelRaw.indexOf("## Do's and Don'ts")).toBeGreaterThan(12000);

    const rules = extractDesignRules(vercelRaw);
    expect(rules).toContain('### Do');
    expect(rules).toContain("### Don't");
    expect(rules).toContain('sixth accent');
    expect(rules.length).toBeLessThanOrEqual(DESIGN_RULES_MAX_CHARS);
  });

  it('stops at the next ## heading (never bleeds into following sections)', () => {
    const raw = `## Do's and Don'ts\n### Do\n- Keep it black.\n\n## Known Gaps\n- Hover states unobserved.\n`;
    const rules = extractDesignRules(raw);
    expect(rules).toContain('Keep it black.');
    expect(rules).not.toContain('Known Gaps');
  });

  it('handles the generated-DESIGN.md shape: numbered heading, curly apostrophes, plus Agent Prompt Guide', () => {
    const raw = [
      '## 7. Do’s and Don’ts',
      '### Do',
      '- Use the coral accent for CTAs only.',
      '## 8. Responsive Behavior',
      '- Stack at 768px.',
      '## 9. Agent Prompt Guide',
      'Warm, editorial, confident. Cream canvas with coral voltage.',
    ].join('\n');
    const rules = extractDesignRules(raw);
    expect(rules).toContain('coral accent');
    expect(rules).toContain('coral voltage');
    expect(rules).not.toContain('Stack at 768px');
  });

  it('returns an empty string when no rules sections exist', () => {
    expect(extractDesignRules('# Brand\n## Colors\n- #fff\n')).toBe('');
  });

  // Regression: the first tag-strip regex (/<[^>]*>/) matched across newlines from a
  // bare "<" to the next ">", silently deleting whole guardrail bullets between them.
  it('keeps comparison operators in guardrails while still stripping real tags', () => {
    const raw = [
      "## Do's and Don'ts",
      '### Do',
      "- Don't shrink body copy < 14px.",
      '- Keep line measure > 45ch on desktop.',
      '- Never inline <script>alert(1)</script> markup.',
    ].join('\n');
    const rules = extractDesignRules(raw);
    expect(rules).toContain('< 14px');
    expect(rules).toContain('> 45ch');
    expect(rules).toContain('Keep line measure');
    expect(rules).not.toContain('<script>');
  });

  it('sanitizes markup and truncates at a line boundary under the cap', () => {
    const bullets = Array.from({ length: 200 }, (_, i) => `- Rule ${i} <script>alert(1)</script> keep tokens \`{colors.primary}\``);
    const raw = `## Do's and Don'ts\n${bullets.join('\n')}\n`;
    const rules = extractDesignRules(raw);
    expect(rules.length).toBeLessThanOrEqual(DESIGN_RULES_MAX_CHARS);
    expect(rules).not.toContain('<script>');
    expect(rules).toContain('{colors.primary}');
    // line-boundary truncation: never ends mid-bullet
    expect(rules.endsWith('`') || rules.endsWith('.')).toBe(true);
  });
});

// Brand Studio emission contract: the freshpress-brand-studio skill authors DESIGN.md
// files against ref/skills/brand-studio/templates/DESIGN.template.md, and the design
// import endpoint parses them with this module. These tests lock the two ends
// together — if the heuristic's positional/hex/font conventions change, the template
// (and the skill's handoff reference) must change with them.
describe('brand-studio DESIGN.md emission contract', () => {
  const templatePath = join(
    __dirname, '..', '..', 'ref', 'skills', 'brand-studio', 'templates', 'DESIGN.template.md'
  );

  it('template placeholders contain no extractable hex codes (nothing can shift positional color assignment)', () => {
    const template = readFileSync(templatePath, 'utf8');
    expect(template.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g)).toBeNull();
  });

  // A filled emission following the template's conventions: palette hexes are the
  // first hexes in the file, in primary/secondary/accent/background/surface/text
  // order, and fonts ride on fontFamily: lines.
  const emission = `# Volta Design System

## 1. Visual Theme & Atmosphere

Aggressive, electric, fast. A racing brand built on charged darkness with a single
voltage-yellow signature streak.

## 2. Color Palette & Roles

- **Volt Yellow** — \`#f5d90a\` — Primary. CTAs, wordmark, the streak.
- **Circuit Blue** — \`#1e3a8a\` — Secondary. Supporting surfaces.
- **Signal Orange** — \`#f97316\` — Accent. Hover heat, small moments.
- **Track Black** — \`#0b0b0e\` — Background. The page canvas.
- **Carbon** — \`#17171c\` — Surface. Cards, raised planes.
- **Headlight** — \`#f4f4f5\` — Text. Primary reading color.
- **Pit Gray** — \`#a1a1aa\` — Text-muted. Captions, metadata.
- **Grid Line** — \`#27272a\` — Border. Hairlines.
- **Green Flag** — \`#22c55e\` — Success.
- **Caution** — \`#eab308\` — Warning.
- **Red Flag** — \`#ef4444\` — Error.

## 3. Typography Rules

- Heading font: Orbitron
  fontFamily: "Orbitron, Rajdhani, sans-serif"
- Body font: Inter
  fontFamily: "Inter, system-ui, sans-serif"

## 7. Do's and Don'ts

Do:
- Reserve Volt Yellow #f5d90a for the single most important action per screen.

Don't:
- Never place Volt Yellow text on Headlight backgrounds.

## 9. Agent Prompt Guide

Volta is an electric race team: charged darkness, one voltage-yellow streak, motion
always implied.
`;

  it('assigns the six positional palette roles from a template-shaped emission', () => {
    const guide = parseDesignMdHeuristic(emission, 'custom_volta1', 'Volta', 'electric racing');
    expect(guide.colors.primary).toBe('#f5d90a');
    expect(guide.colors.secondary).toBe('#1e3a8a');
    expect(guide.colors.accent).toBe('#f97316');
    expect(guide.colors.background).toBe('#0b0b0e');
    expect(guide.colors.surface).toBe('#17171c');
    expect(guide.colors.text).toBe('#f4f4f5');
  });

  it('reads heading/body fonts from the fontFamily lines and rules from section 7', () => {
    const guide = parseDesignMdHeuristic(emission, 'custom_volta1', 'Volta', 'electric racing');
    expect(guide.typography.headingFont).toBe('Orbitron');
    expect(guide.typography.bodyFont).toBe('Inter');
    expect(guide.designRules).toContain('Volt Yellow');
    expect(guide.designRules).toContain('Never place');
  });
});
