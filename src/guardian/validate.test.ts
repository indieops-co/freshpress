import { describe, it, expect } from 'vitest';
import { ingestHtml } from '../ingest/index.js';
import { renderPage } from '../content/render.js';
import {
  validateChanges,
  mergeValidatedSlots,
  validateElementStyleChanges,
  validateElementCustomCss,
  mergeValidatedElementOverrides,
} from '../guardian/validate.js';
import { deriveNamedElements } from '../content/named-elements.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Test Site</title></head>
<body>
  <header><h1>Welcome</h1></header>
  <main>
    <p>First paragraph.</p>
    <p>Second paragraph.</p>
    <a href="/about">About us</a>
    <button>Click me</button>
    <img src="/hero.jpg" alt="Hero image" />
  </main>
</body></html>`;

const CARDS_HTML = `<!DOCTYPE html>
<html><head><title>Acme Plumbing</title></head>
<body>
  <header><h2>Acme</h2></header>
  <section>
    <h1>Fast, friendly plumbing</h1>
    <p>Serving the metro area since 1998.</p>
  </section>
  <section>
    <div class="cards">
      <div class="card"><h3>Repairs</h3><p>Leaks fixed fast.</p></div>
      <div class="card"><h3>Installs</h3><p>New fixtures done right.</p></div>
      <div class="card"><h3>Emergency</h3><p>24/7 call-out.</p></div>
    </div>
  </section>
  <footer><p>© Acme Plumbing</p></footer>
</body></html>`;

function ingestCardsPage() {
  const { content } = ingestHtml('https://acme.example/', CARDS_HTML);
  return deriveNamedElements(content, 1);
}

describe('ingest', () => {
  it('extracts editable slots from HTML', () => {
    const result = ingestHtml('https://example.com/', SAMPLE_HTML);
    expect(result.title).toBe('Test Site');
    expect(Object.keys(result.content.slots).length).toBeGreaterThan(0);
    expect(result.content.template).toContain('{{slot:');
  });

  it('renders back to readable HTML', () => {
    const result = ingestHtml('https://example.com/', SAMPLE_HTML);
    const html = renderPage(result.content);
    expect(html).toContain('Welcome');
    expect(html).toContain('First paragraph');
    expect(html).toContain('href="/about"');
    expect(html).toContain('src="/hero.jpg"');
  });
});

describe('Guardian', () => {
  it('accepts valid text changes', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const slotId = content.slotOrder.find((id) => content.slots[id].value === 'First paragraph.')!;
    const result = validateChanges(content, [{ slotId, value: 'Updated paragraph.' }]);
    expect(result.ok).toBe(true);
  });

  it('rejects script injection', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const slotId = content.slotOrder.find((id) => content.slots[id].type === 'text')!;
    const result = validateChanges(content, [{ slotId, value: '<script>alert(1)</script>' }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('script'))).toBe(true);
  });

  it('rejects emptying structural headings', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const slotId = content.slotOrder.find((id) => content.slots[id].tag === 'h1')!;
    const result = validateChanges(content, [{ slotId, value: '   ' }]);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown slots', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const result = validateChanges(content, [{ slotId: 'fake-slot', value: 'nope' }]);
    expect(result.ok).toBe(false);
  });

  it('applies valid link href changes', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const slotId = content.slotOrder.find((id) => content.slots[id].type === 'link')!;
    const result = validateChanges(content, [{ slotId, href: 'https://example.org/new' }]);
    expect(result.ok).toBe(true);
    const updated = mergeValidatedSlots(content, result.applied!);
    expect(updated.slots[slotId].href).toBe('https://example.org/new');
  });

  it('rejects a slot-value change outside an allowedSlotIds scope', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const inScope = content.slotOrder.find((id) => content.slots[id].tag === 'h1')!;
    const outOfScope = content.slotOrder.find((id) => content.slots[id].value === 'First paragraph.')!;
    const result = validateChanges(content, [{ slotId: outOfScope, value: 'sneaky' }], new Set([inScope]));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('outside the scoped element'))).toBe(true);
  });

  it('accepts a slot-value change inside an allowedSlotIds scope', () => {
    const { content } = ingestHtml('https://example.com/', SAMPLE_HTML);
    const slotId = content.slotOrder.find((id) => content.slots[id].value === 'First paragraph.')!;
    const result = validateChanges(content, [{ slotId, value: 'Updated.' }], new Set([slotId]));
    expect(result.ok).toBe(true);
  });
});

describe('Guardian element style changes', () => {
  const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');

  it('accepts a whitelisted token change on the scoped element itself', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = validateElementStyleChanges(content, styleGuide, card.id, [
      { elementId: card.id, padding: 'lg', radius: 'md' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.appliedStyleOverrides![card.id]).toEqual({ padding: 'lg', radius: 'md' });
  });

  it('accepts a change targeting a nested element within the scoped subtree', () => {
    const content = ingestCardsPage();
    const grid = Object.values(content.namedElements!).find((el) => el.type === 'FeatureGrid')!;
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = validateElementStyleChanges(content, styleGuide, grid.id, [
      { elementId: card.id, shadow: 'md' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.appliedStyleOverrides![card.id]).toEqual({ shadow: 'md' });
  });

  it('rejects a change targeting an element outside the scoped subtree', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const header = Object.values(content.namedElements!).find((el) => el.type === 'Header')!;
    const result = validateElementStyleChanges(content, styleGuide, card.id, [
      { elementId: header.id, padding: 'lg' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("outside the scoped element"))).toBe(true);
  });

  it('rejects a value that is not an existing StyleGuide token', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = validateElementStyleChanges(content, styleGuide, card.id, [
      { elementId: card.id, padding: '14px' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not a valid padding token'))).toBe(true);
  });

  it('rejects malformed changes without throwing (missing elementId)', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    expect(() =>
      validateElementStyleChanges(content, styleGuide, card.id, [
        { padding: 'lg' } as unknown as { elementId: string; padding?: string },
      ])
    ).not.toThrow();
    const result = validateElementStyleChanges(content, styleGuide, card.id, [
      { padding: 'lg' } as unknown as { elementId: string; padding?: string },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects when no StyleGuide is configured', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = validateElementStyleChanges(content, undefined, card.id, [
      { elementId: card.id, padding: 'lg' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('merges applied style overrides onto the NamedElement', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = validateElementStyleChanges(content, styleGuide, card.id, [
      { elementId: card.id, padding: 'lg' },
    ]);
    const updated = mergeValidatedElementOverrides(content, { styleOverrides: result.appliedStyleOverrides });
    expect(updated.namedElements![card.id].styleOverrides).toEqual({ padding: 'lg' });
  });
});

describe('Guardian element custom CSS', () => {
  it('accepts a valid declaration list', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = validateElementCustomCss(content, card.id, [
      { elementId: card.id, customCss: 'letter-spacing: 0.04em; text-transform: uppercase;' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.appliedCustomCss![card.id]).toContain('letter-spacing');
  });

  it('rejects selectors, braces, and script-trigger patterns', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const badInputs = [
      '.card { color: red; }',
      'background: url(javascript:alert(1));',
      '@import "evil.css";',
    ];
    for (const customCss of badInputs) {
      const result = validateElementCustomCss(content, card.id, [{ elementId: card.id, customCss }]);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects custom CSS targeting an element outside the scope', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const header = Object.values(content.namedElements!).find((el) => el.type === 'Header')!;
    const result = validateElementCustomCss(content, card.id, [
      { elementId: header.id, customCss: 'color: red;' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('outside the scoped element'))).toBe(true);
  });

  it('rejects malformed customCss changes without throwing (wrong field name, missing customCss)', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const malformed = [{ elementId: card.id, css: 'color: red;' } as unknown as { elementId: string; customCss: string }];
    expect(() => validateElementCustomCss(content, card.id, malformed)).not.toThrow();
    expect(validateElementCustomCss(content, card.id, malformed).ok).toBe(false);
  });
});
