import { describe, it, expect, vi } from 'vitest';
import {
  planDirections,
  generateSiteDirections,
  headlineOf,
  normalizeHeadline,
  shouldReroll,
} from './generate-site-directions.js';
import { rankScaffolds, selectScaffold, listScaffolds } from '../design/section-patterns.js';
import { buildGeneratedPage, selectIncludedSections } from './generate-page-content.js';

// The generator's only network call. An empty reply builds every page from layout
// fallbacks, so the opt-in threading test below runs offline; nothing else here calls the AI.
vi.mock('./call-json.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./call-json.js')>()),
  callAiJson: async () => '{"sections":[]}',
}));

const saas = selectScaffold('saas').scaffold;
const adjacents = listScaffolds().filter((s) => s.id !== 'saas' && s.id !== 'generic');

describe('rankScaffolds', () => {
  it('ranks the matching industry first and appends generic last', () => {
    const ranked = rankScaffolds('saas', ['modern']);
    expect(ranked[0].id).toBe('saas');
    expect(ranked[ranked.length - 1].id).toBe('generic');
  });

  it('with no signal, returns all scaffolds with generic last (deterministic order)', () => {
    const ranked = rankScaffolds();
    expect(ranked.length).toBe(listScaffolds().length);
    expect(ranked[ranked.length - 1].id).toBe('generic');
  });
});

describe('planDirections', () => {
  it('count=1 → just the base scaffold, full', () => {
    const plans = planDirections(saas, adjacents, 1);
    expect(plans).toHaveLength(1);
    expect(plans[0].scaffold.id).toBe('saas');
    expect(plans[0].dropSectionIds).toEqual([]);
    expect(plans[0].fingerprint[0]).toBe('Nav');
  });

  it('count=3 → three structurally DISTINCT directions (different fingerprints)', () => {
    const plans = planDirections(saas, adjacents, 3);
    expect(plans).toHaveLength(3);
    const keys = plans.map((p) => p.fingerprint.join('>'));
    expect(new Set(keys).size).toBe(3); // all distinct
  });

  it('the first direction is always the base, full layout', () => {
    const plans = planDirections(saas, adjacents, 3);
    expect(plans[0].scaffold.id).toBe('saas');
    expect(plans[0].dropSectionIds).toEqual([]);
    expect(plans[0].directive).toMatch(/complete/);
  });

  it('a fingerprint matches the page the builder would actually produce for that plan', async () => {
    const { buildGeneratedPage, selectIncludedSections, pageFingerprint } = await import('./generate-page-content.js');
    const plans = planDirections(saas, adjacents, 3);
    for (const plan of plans) {
      const included = selectIncludedSections(
        plan.scaffold,
        { sections: plan.scaffold.sections.map((s) => ({ id: s.id, include: true, fields: {}, items: [] })) },
        plan.dropSectionIds
      );
      const page = buildGeneratedPage(included);
      // The built page's section-type sequence (page-root children) equals the plan fingerprint.
      const builtTypes = page.containers![0].children.map((c) => c.suggestedType);
      expect(builtTypes).toEqual(plan.fingerprint);
      // Sanity: pageFingerprint over the same sections agrees.
      expect(pageFingerprint(included)).toEqual(plan.fingerprint);
    }
  });

  it('is clamped to [1,3] and always returns the requested count', () => {
    expect(planDirections(saas, adjacents, 0)).toHaveLength(1);
    expect(planDirections(saas, adjacents, 9)).toHaveLength(3);
  });

  it('still returns distinct-where-possible directions when there are no adjacents', () => {
    // Base only: divergence must come from dropping optional sections.
    const plans = planDirections(saas, [], 3);
    expect(plans).toHaveLength(3);
    const keys = new Set(plans.map((p) => p.fingerprint.join('>')));
    // saas has 3 optional sections, so 3 distinct structures are achievable base-only.
    expect(keys.size).toBe(3);
  });
});

/**
 * The newsletter signup is opt-in (plan-gated in site-generation.ts), never a
 * fan-out drop candidate: with it off, 3-direction plans are exactly what they
 * were before SignupForm existed; opting in keeps the same plans and just adds
 * the section to each.
 */
describe('planDirections with the opt-in signup section', () => {
  // Fingerprints as origin/main produced them before SignupForm, locked literally.
  const SERVICE = ['Nav', 'HeroSection', 'FeatureGrid', 'InfoCard', 'TestimonialCard', 'CTASection', 'Form', 'Footer'];
  const SAAS = ['Nav', 'HeroSection', 'HeroImage', 'Gallery', 'FeatureGrid', 'TestimonialCard', 'PricingTable', 'FAQItem', 'CTASection', 'Footer'];
  const GENERIC = ['Nav', 'HeroSection', 'FeatureGrid', 'InfoCard', 'TestimonialCard', 'CTASection', 'Footer'];
  const noTestimonials = (fp: string[]) => fp.filter((t) => t !== 'TestimonialCard');
  const withSignup = (fp: string[]) => [...fp.slice(0, -1), 'SignupForm', 'Footer'];

  const [serviceBase, ...serviceAdjacents] = rankScaffolds('service-business');
  const generic = listScaffolds().find((s) => s.id === 'generic')!;
  const genericAdjacents = listScaffolds().filter((s) => s.id !== 'generic');
  const shape = (plans: ReturnType<typeof planDirections>) => plans.map((p) => [p.scaffold.id, p.dropSectionIds]);

  it('service-business count=3 is unchanged: full → drop testimonials → adjacent (not "drop signup")', () => {
    const plans = planDirections(serviceBase, serviceAdjacents, 3);
    expect(shape(plans)).toEqual([
      ['service-business', []],
      ['service-business', ['testimonials']],
      ['saas', []],
    ]);
    expect(plans.map((p) => p.fingerprint)).toEqual([SERVICE, noTestimonials(SERVICE), SAAS]);
  });

  it('generic count=3 is unchanged: full → drop testimonials → adjacent', () => {
    const plans = planDirections(generic, genericAdjacents, 3);
    expect(shape(plans)).toEqual([
      ['generic', []],
      ['generic', ['testimonials']],
      ['service-business', []],
    ]);
    expect(plans.map((p) => p.fingerprint)).toEqual([GENERIC, noTestimonials(GENERIC), SERVICE]);
  });

  it('opting in picks the same plans and adds SignupForm (before the footer) to each', () => {
    const service = planDirections(serviceBase, serviceAdjacents, 3, true);
    expect(shape(service)).toEqual(shape(planDirections(serviceBase, serviceAdjacents, 3)));
    expect(service.map((p) => p.fingerprint)).toEqual([SERVICE, noTestimonials(SERVICE), SAAS].map(withSignup));

    const gen = planDirections(generic, genericAdjacents, 3, true);
    expect(shape(gen)).toEqual(shape(planDirections(generic, genericAdjacents, 3)));
    expect(gen.map((p) => p.fingerprint)).toEqual([GENERIC, noTestimonials(GENERIC), SERVICE].map(withSignup));
  });
});

describe('generateSiteDirections threads the signup opt-in to every built page', () => {
  const run = (includeOptIn?: boolean) =>
    generateSiteDirections({
      scaffolds: rankScaffolds('service-business'),
      ctx: { brandName: 'Acme' },
      count: 3,
      credentials: { provider: 'anthropic', apiKey: 'test' },
      includeOptIn,
    });

  it('default: no direction carries a signup form', async () => {
    for (const d of await run()) {
      expect(d.fingerprint).not.toContain('SignupForm');
      expect(d.page.content.template).not.toContain('data-fp-form="signup"');
    }
  });

  it('opted in: every direction carries the form, valid and matching its plan', async () => {
    const [base, ...adjacents] = rankScaffolds('service-business');
    const plans = planDirections(base, adjacents, 3, true);
    const directions = await run(true);
    directions.forEach((d, i) => {
      expect(d.fingerprint).toEqual(plans[i].fingerprint);
      expect(d.page.content.template).toContain('data-fp-form="signup"');
      expect(d.valid, d.errors.join('; ')).toBe(true);
    });
  });
});

/**
 * The duplicate-headline guard: the soft avoid-list alone let two directions
 * open with the same h1, so the loop now compares each new direction's opener
 * against all priors and re-rolls at most once. These are its pure pieces.
 */
describe('headline dedup helpers', () => {
  const page = () =>
    buildGeneratedPage(
      selectIncludedSections(saas, {
        sections: saas.sections.map((s) => ({ id: s.id, include: true, fields: {}, items: [] })),
      }),
      1
    );

  it('headlineOf finds the h1 slot value', () => {
    const p = page();
    const h1 = headlineOf(p);
    expect(typeof h1).toBe('string');
    expect(h1!.length).toBeGreaterThan(0);
    const slot = Object.values(p.slots).find((s) => s.tag === 'h1');
    expect(h1).toBe(slot!.value.trim());
  });

  it('headlineOf returns null for a page with no h1', () => {
    const p = page();
    for (const slot of Object.values(p.slots)) {
      if (slot.tag === 'h1') slot.tag = 'h2';
    }
    expect(headlineOf(p)).toBeNull();
  });

  it('normalizeHeadline folds case and whitespace', () => {
    expect(normalizeHeadline('  A Garden   That THRIVES ')).toBe('a garden that thrives');
  });

  it('shouldReroll only fires on a normalized match against priors', () => {
    expect(shouldReroll('A garden that thrives', ['a garden  that thrives'])).toBe(true);
    expect(shouldReroll('A garden that thrives', ['Yards built for how you live'])).toBe(false);
    expect(shouldReroll('A garden that thrives', [])).toBe(false);
    expect(shouldReroll(null, ['A garden that thrives'])).toBe(false);
    expect(shouldReroll('', ['A garden that thrives'])).toBe(false);
  });
});
