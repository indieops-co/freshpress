import { describe, it, expect } from 'vitest';
import {
  buildGeneratedPage,
  buildGenerationPrompt,
  parseGeneratedContent,
  selectIncludedSections,
  pageFingerprint,
  layoutForType,
  type BuiltSection,
  type GeneratedContent,
} from './generate-page-content.js';
import { selectScaffold, listScaffolds } from '../design/section-patterns.js';
import { validateGeneratedPage } from '../guardian/validate-generated-page.js';
import { BRAND_CONTEXT_MAX_CHARS } from '../content/brand-voice-context.js';
import { DESIGN_RULES_MAX_CHARS } from '../design/design-excellence.js';
import { renderPage } from '../content/render.js';
import { parseElementId } from '../content/named-elements.js';

const saas = selectScaffold('saas').scaffold;

/** A fully-populated GeneratedContent for a scaffold (every section, generous items). */
function fullContent(scaffoldSections = saas.sections): GeneratedContent {
  return {
    sections: scaffoldSections.map((s) => ({
      id: s.id,
      fields: { headline: 'Ship faster', subhead: 'Do more', title: 'Why us', name: 'Pro', price: '$29', headline2: '' },
      items: [
        { title: 'One', body: 'a', name: 'Starter', price: '$0', features: 'x', quote: 'Great', author: 'Sam', q: 'Q?', a: 'A.', caption: 'c' },
        { title: 'Two', body: 'b', name: 'Pro', price: '$29', features: 'y', quote: 'Love it', author: 'Kim', q: 'Q2?', a: 'A2.', caption: 'c2' },
        { title: 'Three', body: 'c', name: 'Team', price: '$99', features: 'z', quote: 'Best', author: 'Lee', q: 'Q3?', a: 'A3.', caption: 'c3' },
      ],
    })),
  };
}

describe('buildGeneratedPage', () => {
  const sections = selectIncludedSections(saas, fullContent());
  const page = buildGeneratedPage(sections, 1);

  it('produces a page that passes validateGeneratedPage', () => {
    const v = validateGeneratedPage(page);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('stamps every named element with source "generated" and well-formed ids', () => {
    const els = Object.values(page.namedElements!);
    expect(els.length).toBeGreaterThan(0);
    expect(els.every((e) => e.source === 'generated')).toBe(true);
    expect(els.every((e) => parseElementId(e.id))).toBe(true);
  });

  it('emits a page-root container plus one container per section (and per card)', () => {
    const roots = page.containers!;
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('page-root');
    expect(roots[0].suggestedType).toBe('Page');
    // Nav + Hero + … are direct children of the page root.
    const childTypes = roots[0].children.map((c) => c.suggestedType);
    expect(childTypes).toContain('Nav');
    expect(childTypes).toContain('HeroSection');
    expect(childTypes).toContain('FeatureGrid');
  });

  it('renders with every container path resolvable (data-element-id stamped, no leftover placeholders)', () => {
    const html = renderPage(page);
    expect(html).not.toMatch(/\{\{slot:/);
    for (const el of Object.values(page.namedElements!)) {
      expect(html).toContain(`data-element-id="${el.id}"`);
    }
  });

  it('uses the theme .fp-* classes so the StyleGuide stylesheet applies', () => {
    expect(page.template).toContain('class="fp-nav"');
    expect(page.template).toContain('class="fp-hero"');
    expect(page.template).toContain('fp-btn-primary');
    expect(page.template).toContain('class="fp-card"');
  });

  it('is deterministic — same input, byte-identical template', () => {
    const again = buildGeneratedPage(selectIncludedSections(saas, fullContent()), 1);
    expect(again.template).toBe(page.template);
    expect(Object.keys(again.slots)).toEqual(Object.keys(page.slots));
  });

  it('honors pageNumber in element ids', () => {
    const p2 = buildGeneratedPage(sections, 2);
    expect(Object.keys(p2.namedElements!).every((id) => id.endsWith('-p2'))).toBe(true);
  });
});

describe('buildGeneratedPage fallbacks', () => {
  it('fills layout fallbacks when the AI omits fields — no empty slots, still valid', () => {
    // No AI content at all: every section falls back to its layout defaults.
    const sections = selectIncludedSections(saas, { sections: [] });
    const page = buildGeneratedPage(sections);
    expect(validateGeneratedPage(page).ok).toBe(true);
    expect(Object.values(page.slots).every((s) => s.value.trim() !== '')).toBe(true);
    // Required sections still present.
    const types = Object.values(page.namedElements!).map((e) => e.type);
    expect(types).toContain('HeroSection');
  });
});

describe('selectIncludedSections', () => {
  it('always includes required sections and honors an explicit drop set for optional ones', () => {
    const content = fullContent();
    // saas: `logos`, `testimonials`, `faq` are optional.
    const dropped = selectIncludedSections(saas, content, ['logos', 'faq']);
    const ids = dropped.map((s) => s.id);
    expect(ids).not.toContain('logos');
    expect(ids).not.toContain('faq');
    expect(ids).toContain('hero'); // required
    expect(ids).toContain('pricing'); // required
  });

  it('structure is deterministic: an optional section is kept unless the fan-out drops it (AI cannot drop sections)', () => {
    // Even with NO AI content, every non-dropped section is present — the model doesn't choose structure.
    const all = selectIncludedSections(saas, { sections: [] }).map((s) => s.id);
    expect(all).toContain('testimonials'); // optional, not dropped → kept
    expect(all).toContain('hero'); // required → kept
    // Order matches the scaffold order (opt-in sections are out unless requested).
    expect(all).toEqual(saas.sections.filter((s) => !s.optIn).map((s) => s.id));
  });

  it('attaches the matching AI content to each kept section', () => {
    const content = fullContent();
    const kept = selectIncludedSections(saas, content, ['logos']);
    const hero = kept.find((s) => s.id === 'hero');
    expect(hero?.content?.fields.headline).toBe('Ship faster');
    expect(kept.find((s) => s.id === 'logos')).toBeUndefined();
  });
});

describe('parseGeneratedContent', () => {
  it('parses a fenced JSON block and keeps only known section ids', () => {
    const text = 'Here you go:\n```json\n{ "sections": [ { "id": "hero", "fields": { "headline": "Hi" } }, { "id": "not-a-section", "fields": {} } ] }\n```';
    const parsed = parseGeneratedContent(text, saas);
    expect(parsed.sections.map((s) => s.id)).toEqual(['hero']);
    expect(parsed.sections[0].fields.headline).toBe('Hi');
  });

  it('parses a bare JSON object embedded in prose (no code fence)', () => {
    const text = 'Sure! { "sections": [ { "id": "hero", "fields": { "headline": "Hi there" } } ] } Hope that helps.';
    const parsed = parseGeneratedContent(text, saas);
    expect(parsed.sections.map((s) => s.id)).toEqual(['hero']);
    expect(parsed.sections[0].fields.headline).toBe('Hi there');
  });

  it('de-duplicates repeated section ids (keeps the first)', () => {
    const text = JSON.stringify({ sections: [{ id: 'hero', fields: { headline: 'first' } }, { id: 'hero', fields: { headline: 'second' } }] });
    const parsed = parseGeneratedContent(text, saas);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].fields.headline).toBe('first');
  });

  it('coerces numbers/booleans to strings and ignores non-string junk', () => {
    const text = JSON.stringify({ sections: [{ id: 'pricing', fields: { price: 29, active: true, bad: { x: 1 } }, items: [{ name: 'Pro' }] }] });
    const parsed = parseGeneratedContent(text, saas);
    expect(parsed.sections[0].fields.price).toBe('29');
    expect(parsed.sections[0].fields.active).toBe('true');
    expect(parsed.sections[0].fields.bad).toBeUndefined();
    expect(parsed.sections[0].items[0].name).toBe('Pro');
  });

  it('returns an empty result on unparseable output (never throws)', () => {
    expect(parseGeneratedContent('sorry, I cannot help', saas).sections).toEqual([]);
    expect(parseGeneratedContent('', saas).sections).toEqual([]);
  });
});

describe('buildGenerationPrompt', () => {
  it('lists every section id, its field keys, and item ranges, plus the brand context', () => {
    const { system, user } = buildGenerationPrompt(saas, {
      brandName: 'Acme',
      industry: 'SaaS',
      personality: ['modern'],
      designDirection: 'clean and technical',
      variationDirective: 'lead with the product screenshot',
    });
    expect(system).toContain('ONLY valid JSON');
    expect(user).toContain('Brand: Acme');
    expect(user).toContain('clean and technical');
    expect(user).toContain('lead with the product screenshot');
    expect(user).toContain('id "hero"');
    // FeatureGrid section advertises its item shape.
    expect(user).toMatch(/items\[\]:/);
  });

  it('carries the brand design rules into the user prompt and microcopy discipline into the system prompt', () => {
    const { system, user } = buildGenerationPrompt(saas, {
      brandName: 'Acme',
      designRules: "### Do\n- Reserve black for CTAs\n### Don't\n- No sixth accent",
    });
    expect(user).toContain("Design rules for this brand (follow the Do's, avoid the Don'ts):");
    expect(user).toContain('No sixth accent');
    // copyExcellence() marker — the copywriter gets writing discipline, not aesthetics.
    expect(system).toContain('Save changes');
    expect(system).not.toContain('cream background');
  });

  it('omits the rules block when the context has none, and re-caps oversized rules', () => {
    const bare = buildGenerationPrompt(saas, { brandName: 'Acme' });
    expect(bare.user).not.toContain('Design rules for this brand');

    const huge = buildGenerationPrompt(saas, { brandName: 'Acme', designRules: 'x'.repeat(5000) });
    const injected = huge.user.match(/x+/)?.[0] ?? '';
    expect(injected.length).toBeGreaterThan(0);
    expect(injected.length).toBeLessThanOrEqual(2000);
  });
});

describe('pageFingerprint / layoutForType', () => {
  it('fingerprint is the ordered section types', () => {
    const sections: BuiltSection[] = [
      { id: 'nav', type: 'Nav' },
      { id: 'hero', type: 'HeroSection' },
    ];
    expect(pageFingerprint(sections)).toEqual(['Nav', 'HeroSection']);
  });

  it('every scaffold section type resolves to a DEDICATED (non-generic) layout', () => {
    const generic = layoutForType('__definitely_not_a_type__');
    for (const scaffold of listScaffolds()) {
      for (const section of scaffold.sections) {
        // If a real type ever loses its LAYOUTS entry, this catches it (unlike a truthy-tag check).
        expect(layoutForType(section.type)).not.toBe(generic);
      }
    }
  });

  it('an unknown type falls back to the generic layout', () => {
    const generic = layoutForType('ServiceAreaMap'); // a plausible AI-discovered type
    expect(generic.tag).toBe('section');
    expect(generic.fields.some((f) => f.tag === 'h2')).toBe(true);
    expect(generic.card).toBeUndefined();
  });
});

describe('all bundled scaffolds build + validate + render end-to-end', () => {
  // Not just saas: e.g. restaurant-local has two InfoCard-typed sections plus InfoCard cards —
  // exactly the same-type-multiple-source shape where a path/index collision would surface.
  for (const scaffold of listScaffolds()) {
    it(`${scaffold.id} produces a valid, fully-resolvable page`, () => {
      // Opt-in sections included: the superset page a scaffold can produce.
      const page = buildGeneratedPage(selectIncludedSections(scaffold, { sections: [] }, [], true));
      const v = validateGeneratedPage(page);
      expect(v.ok, `${scaffold.id}: ${v.errors.join('; ')}`).toBe(true);
      const html = renderPage(page);
      expect(html).not.toMatch(/\{\{slot:/);
      for (const elx of Object.values(page.namedElements!)) {
        expect(html).toContain(`data-element-id="${elx.id}"`);
      }
    });
  }
});

describe('card min/max clamping', () => {
  it('clamps to the layout max when the AI returns too many items', () => {
    // FeatureGrid max is 6. Supply 12 items.
    const items = Array.from({ length: 12 }, (_v, i) => ({ title: `T${i}`, body: `B${i}` }));
    const page = buildGeneratedPage(
      selectIncludedSections(selectScaffold('generic').scaffold, { sections: [{ id: 'features', fields: {}, items }] }).filter((s) => s.id === 'features')
    );
    const cards = page.containers![0].children[0].children; // the FeatureGrid's card children
    expect(cards.length).toBe(6);
    expect(validateGeneratedPage(page).ok).toBe(true);
  });

  it('pads to the layout min when the AI returns too few items', () => {
    // FeatureGrid min is 3. Supply 1 item.
    const page = buildGeneratedPage(
      selectIncludedSections(selectScaffold('generic').scaffold, { sections: [{ id: 'features', fields: {}, items: [{ title: 'Only one' }] }] }).filter((s) => s.id === 'features')
    );
    const cards = page.containers![0].children[0].children;
    expect(cards.length).toBe(3);
  });
});

describe('image slots', () => {
  it('keep the placeholder URL and take ONLY the model-supplied alt text', () => {
    // HeroImage layout has an image field keyed "image"; the model supplies "imageAlt".
    const scaffold = selectScaffold('saas').scaffold; // includes a HeroImage section (id "productShot")
    const page = buildGeneratedPage(
      selectIncludedSections(scaffold, {
        sections: [{ id: 'productShot', fields: { image: 'IGNORED junk the model should not set as a src', imageAlt: 'The Verifly dashboard' }, items: [] }],
      })
    );
    const imgSlot = Object.values(page.slots).find((s) => s.type === 'image');
    expect(imgSlot).toBeDefined();
    expect(imgSlot!.tag).toBe('img');
    expect(imgSlot!.value).toMatch(/^https?:\/\//); // still the placeholder URL, not the model's text
    expect(imgSlot!.value).not.toContain('junk');
    expect(imgSlot!.alt).toBe('The Verifly dashboard');
  });

  it('advertises the <key>Alt key (not a raw image URL key) in the prompt', () => {
    const { user } = buildGenerationPrompt(selectScaffold('saas').scaffold, { brandName: 'Acme' });
    expect(user).toContain('imageAlt');
  });
});

describe('contact form (Form layout)', () => {
  const page = buildGeneratedPage([{ id: 'contact', type: 'Form' }], 1);
  const html = renderPage(page);

  it('emits a real, submittable form with a stable selector and the three fields', () => {
    expect(page.template).toContain('<form');
    expect(page.template).toContain('data-fp-form="contact"');
    expect(page.template).toContain('method="post"');
    expect(page.template).toContain('fp-contact-form');
    expect(page.template).toContain('name="name"');
    expect(page.template).toContain('type="email"');
    expect(page.template).toContain('name="email"');
    expect(page.template).toContain('name="message"');
    expect(page.template).toContain('<textarea');
    // The submit copy is an editable slot rendered as a real submit control.
    expect(html).toMatch(/<button[^>]*class="fp-btn-primary"[^>]*>Send<\/button>/);
  });

  it('stays guardian-clean (no <script>/on*=) and fully resolvable', () => {
    expect(page.template).not.toMatch(/<script\b|javascript:|on\w+\s*=/i);
    const v = validateGeneratedPage(page);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect(html).not.toMatch(/\{\{slot:/);
  });
});

describe('signup form (SignupForm layout)', () => {
  const page = buildGeneratedPage([{ id: 'signup', type: 'SignupForm' }], 1);
  const html = renderPage(page);

  it('emits a submittable signup form with the stable selector and name/email fields', () => {
    expect(page.template).toContain('<form');
    expect(page.template).toContain('data-fp-form="signup"');
    expect(page.template).toContain('method="post"');
    expect(page.template).toContain('fp-signup-form');
    expect(page.template).toContain('name="name"');
    expect(page.template).toContain('type="email"');
    expect(page.template).toContain('name="email"');
    // A signup form has no message box — that's the contact form's shape.
    expect(page.template).not.toContain('name="message"');
    expect(html).toMatch(/<button[^>]*class="fp-btn-primary"[^>]*>Subscribe<\/button>/);
  });

  it('stays guardian-clean (no <script>/on*=) and fully resolvable', () => {
    expect(page.template).not.toMatch(/<script\b|javascript:|on\w+\s*=/i);
    const v = validateGeneratedPage(page);
    expect(v.ok, v.errors.join('; ')).toBe(true);
    expect(html).not.toMatch(/\{\{slot:/);
  });

  it('is offered as an opt-in (never fan-out-optional) section by content/marketing scaffolds', () => {
    const withSignup = listScaffolds().filter((s) =>
      s.sections.some((sec) => sec.type === 'SignupForm')
    );
    expect(withSignup.map((s) => s.id).sort()).toEqual(
      ['ecommerce', 'generic', 'professional-services', 'saas', 'service-business'].sort()
    );
    for (const scaffold of withSignup) {
      const section = scaffold.sections.find((sec) => sec.type === 'SignupForm')!;
      expect(section.optIn, `${scaffold.id} signup section must be opt-in`).toBe(true);
      // `optional` would make it a fan-out drop candidate — the variation axis it must never be.
      expect(section.optional, `${scaffold.id} signup section must not be optional`).toBe(false);
    }
  });

  it('is left out by default and included only when the request opts in', () => {
    const serviceBusiness = selectScaffold('service-business').scaffold;
    const byDefault = selectIncludedSections(serviceBusiness, { sections: [] }).map((s) => s.type);
    expect(byDefault).not.toContain('SignupForm');
    const optedIn = selectIncludedSections(serviceBusiness, { sections: [] }, [], true).map((s) => s.type);
    expect(optedIn).toContain('SignupForm');
    expect(optedIn.indexOf('SignupForm')).toBe(optedIn.length - 2); // just before the footer
    // A fan-out drop set can't remove an opted-in section (it's not optional).
    expect(selectIncludedSections(serviceBusiness, { sections: [] }, ['signup'], true).map((s) => s.id)).toContain('signup');
  });

  it('only asks the AI for signup copy when the request opts in', () => {
    expect(buildGenerationPrompt(saas, { brandName: 'Acme' }).user).not.toContain('id "signup"');
    expect(buildGenerationPrompt(saas, { brandName: 'Acme' }, true).user).toContain('id "signup" (SignupForm)');
  });
});

describe('combined prompt budget (roadmap §5/§7)', () => {
  // Every context block individually capped upstream (constants imported so
  // this tripwire moves when the caps move). This asserts their SUM stays
  // bounded so the next block that joins the prompt triggers a conscious
  // budget decision instead of silent growth. Measured max today: ~8,330
  // chars (saas scaffold, every input at its cap).
  const COMBINED_PROMPT_BUDGET_CHARS = 10_000;

  it('system+user stay under the combined budget with every block at its cap', () => {
    const biggest = [...listScaffolds()].sort((a, b) => b.sections.length - a.sections.length)[0];
    const { system, user } = buildGenerationPrompt(biggest, {
      brandName: 'B'.repeat(60),
      industry: 'professional services and consulting',
      personality: Array(12).fill('dependable'),
      targetAudience: 'A'.repeat(200),
      moodKeywords: Array(10).fill('confident'),
      designDirection: 'D'.repeat(300),
      variationDirective: 'V'.repeat(400),
      brandResearch: 'R'.repeat(BRAND_CONTEXT_MAX_CHARS),
      designRules: '- rule line\n'.repeat(Math.ceil(DESIGN_RULES_MAX_CHARS / 12)),
    }, true); // opt-in sections in: the largest prompt the scaffold can produce
    expect(system.length + user.length).toBeLessThanOrEqual(COMBINED_PROMPT_BUDGET_CHARS);
  });
});
