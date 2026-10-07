import { describe, it, expect } from 'vitest';
import {
  listScaffolds,
  loadBundledScaffolds,
  selectScaffold,
  selectScaffoldFrom,
  scoreScaffold,
  structuralFingerprint,
  GENERIC_SCAFFOLD_ID,
  IndustryScaffoldSchema,
  type IndustryScaffold,
} from './section-patterns.js';

describe('section-patterns manifest', () => {
  it('parses the bundled seed and includes the generic fallback + the six named industries', () => {
    const scaffolds = listScaffolds();
    const ids = scaffolds.map((s) => s.id);
    expect(ids).toContain(GENERIC_SCAFFOLD_ID);
    for (const id of [
      'service-business',
      'saas',
      'ecommerce',
      'portfolio',
      'restaurant-local',
      'professional-services',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('every scaffold validates against the schema and has at least one section', () => {
    for (const scaffold of listScaffolds()) {
      expect(() => IndustryScaffoldSchema.parse(scaffold)).not.toThrow();
      expect(scaffold.sections.length).toBeGreaterThan(0);
    }
  });

  it('loadBundledScaffolds() reads the process.cwd()-relative manifest and matches the bundled import', async () => {
    // Runs from the repo root (vitest cwd), so the runtime read succeeds and agrees with listScaffolds().
    const runtime = await loadBundledScaffolds();
    expect(runtime.map((s) => s.id)).toEqual(listScaffolds().map((s) => s.id));
  });
});

describe('selectScaffold (against the real bundled seed)', () => {
  it('matches an exact industry label', () => {
    const sel = selectScaffold('SaaS / software');
    expect(sel.scaffold.id).toBe('saas');
    expect(sel.matchType).toBe('exact');
    expect(sel.score).toBeGreaterThanOrEqual(100);
  });

  it('matches via a single-word alias inside free-text industry (partial)', () => {
    const sel = selectScaffold('we run a small neighborhood cafe');
    expect(sel.scaffold.id).toBe('restaurant-local');
    expect(sel.matchType).toBe('partial');
  });

  it('treats a listed multi-word alias as an exact match ("online store")', () => {
    const sel = selectScaffold('online store');
    expect(sel.scaffold.id).toBe('ecommerce');
    expect(sel.matchType).toBe('exact');
  });

  it('matches (partial) when a multi-word alias appears inside a longer phrase', () => {
    const sel = selectScaffold('i run an online store for pet supplies');
    expect(sel.scaffold.id).toBe('ecommerce');
    expect(sel.matchType).toBe('partial');
  });

  it('matches via the input being a substring of a candidate ("ecomm" ⊂ "ecommerce")', () => {
    const sel = selectScaffold('ecomm');
    expect(sel.scaffold.id).toBe('ecommerce');
    expect(sel.matchType).toBe('partial');
  });

  // Regression: generic single-word aliases ("shop"/"brand") used to win whole-word ties purely by
  // manifest order, so "coffee shop" and "personal brand" both mis-resolved to ecommerce.
  it('resolves "coffee shop" to restaurant (multi-word alias outranks the generic "shop")', () => {
    const sel = selectScaffold('coffee shop');
    expect(sel.scaffold.id).toBe('restaurant-local');
  });

  it('resolves "personal brand" to portfolio (ecommerce no longer aliases the generic "brand")', () => {
    const sel = selectScaffold('personal brand');
    expect(sel.scaffold.id).toBe('portfolio');
  });

  // The anti-substring guard: a short alias must not spuriously match inside an unrelated word.
  it('does not let "shop" inside "barbershop" spuriously match ecommerce', () => {
    const sel = selectScaffold('barbershop');
    expect(sel.scaffold.id).toBe(GENERIC_SCAFFOLD_ID);
    expect(sel.matchType).toBe('generic');
  });

  it('does not let "app" inside "our software library" match saas', () => {
    const sel = selectScaffold('our software library');
    // "software" is a saas alias (whole word) — this should hit saas, NOT via a stray "app" substring.
    expect(sel.scaffold.id).toBe('saas');
    expect(sel.matchType).toBe('partial');
  });

  it('falls back to the generic scaffold when the industry is unknown and no signals help', () => {
    const sel = selectScaffold('interpretive underwater basket weaving');
    expect(sel.scaffold.id).toBe(GENERIC_SCAFFOLD_ID);
    expect(sel.matchType).toBe('generic');
    expect(sel.score).toBe(0);
  });

  it('falls back to the generic scaffold when nothing is provided at all', () => {
    const sel = selectScaffold();
    expect(sel.scaffold.id).toBe(GENERIC_SCAFFOLD_ID);
    expect(sel.matchType).toBe('generic');
  });

  it('uses personality/mood affinity to pick when there is no industry signal', () => {
    // No industry, but "warm" + "organic" affinity points at restaurant-local.
    const sel = selectScaffold(undefined, ['warm'], ['organic']);
    expect(sel.scaffold.id).toBe('restaurant-local');
    expect(sel.matchType).toBe('affinity');
    expect(sel.score).toBeGreaterThan(0);
  });

  it('lets a strong industry match outweigh affinity for a different scaffold', () => {
    // Industry says SaaS; personality "warm" leans restaurant — industry (100) wins.
    const sel = selectScaffold('saas', ['warm'], ['organic']);
    expect(sel.scaffold.id).toBe('saas');
  });
});

describe('scoreScaffold', () => {
  const saas = listScaffolds().find((s) => s.id === 'saas')!;

  it('scores an exact industry hit at 100+ and reports industryMatch "exact"', () => {
    const { score, industryMatch } = scoreScaffold(saas, 'saas');
    expect(industryMatch).toBe('exact');
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('reports "partial" for a fuzzy word/phrase match, not "exact"', () => {
    expect(scoreScaffold(saas, 'a software tool').industryMatch).toBe('partial');
  });

  it('adds affinity points on top of an industry hit', () => {
    const base = scoreScaffold(saas, 'saas').score;
    const withAffinity = scoreScaffold(saas, 'saas', ['modern', 'technical'], ['clean']).score;
    expect(withAffinity).toBeGreaterThan(base);
  });

  it('never counts the generic scaffold as an industry match', () => {
    const generic = listScaffolds().find((s) => s.id === GENERIC_SCAFFOLD_ID)!;
    const { industryMatch } = scoreScaffold(generic, 'general / other');
    expect(industryMatch).toBeNull();
  });
});

describe('selectScaffoldFrom (pure, synthetic fixtures)', () => {
  const mk = (id: string, over: Partial<IndustryScaffold> = {}): IndustryScaffold =>
    IndustryScaffoldSchema.parse({
      id,
      industry: id,
      aliases: [],
      name: id,
      desc: id,
      sections: [{ id: 's', type: 'HeroSection', label: 'Hero', intent: 'x' }],
      ...over,
    });

  it('breaks score ties toward the earlier scaffold in the list (deterministic)', () => {
    const a = mk('a', { personalityAffinity: ['bold'] });
    const b = mk('b', { personalityAffinity: ['bold'] });
    const generic = mk(GENERIC_SCAFFOLD_ID);
    const sel = selectScaffoldFrom([a, b, generic], undefined, ['bold']);
    expect(sel.scaffold.id).toBe('a');
  });

  it('returns the first scaffold as fallback when no generic id is present', () => {
    const a = mk('a');
    const b = mk('b');
    const sel = selectScaffoldFrom([a, b], 'nothing-matches');
    expect(sel.scaffold.id).toBe('a');
    expect(sel.matchType).toBe('generic');
  });

  it('throws only on a truly empty scaffold list', () => {
    expect(() => selectScaffoldFrom([], 'x')).toThrow();
  });
});

describe('structuralFingerprint', () => {
  it('is the ordered list of section types (the Chunk 8 avoid-list)', () => {
    const saas = listScaffolds().find((s) => s.id === 'saas')!;
    const fp = structuralFingerprint(saas);
    expect(fp[0]).toBe('Nav');
    expect(fp).toContain('PricingTable');
    expect(fp[fp.length - 1]).toBe('Footer');
    expect(fp).toEqual(saas.sections.map((s) => s.type));
  });
});
