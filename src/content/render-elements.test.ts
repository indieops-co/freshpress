import { describe, expect, it } from 'vitest';
import { renderPage, generateElementOverrides } from './render.js';
import { injectElementIds } from './containers.js';
import { ingestHtml } from '../ingest/index.js';
import { deriveNamedElements } from './named-elements.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';
import type { NamedElement } from './types.js';

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

describe('injectElementIds', () => {
  it('stamps data-element-id on every named container, including the page root', () => {
    const content = ingestCardsPage();
    const html = injectElementIds(content.template, content.containers!);
    for (const el of Object.values(content.namedElements!)) {
      expect(html).toContain(`data-element-id="${el.id}"`);
    }
    const root = Object.values(content.namedElements!).find((el) => el.type === 'Page')!;
    expect(html).toMatch(new RegExp(`<body[^>]*data-element-id="${root.id}"`));
  });

  it('does not touch the template when there are no containers', () => {
    const html = injectElementIds('<body><p>hi</p></body>', []);
    expect(html).not.toContain('data-element-id');
  });
});

describe('renderPage with named elements', () => {
  it('renders data-element-id attributes for a page with containers', () => {
    const content = ingestCardsPage();
    const html = renderPage(content);
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    expect(html).toContain(`data-element-id="${card.id}"`);
  });

  it('injects styleOverrides as CSS resolved through the StyleGuide', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    content.namedElements![card.id] = { ...content.namedElements![card.id], styleOverrides: { padding: 'lg', radius: 'md' } };
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');

    const html = renderPage(content, styleGuide);
    expect(html).toContain('<style data-fp-element-overrides>');
    expect(html).toContain(`[data-element-id="${card.id}"]`);
    expect(html).toContain(`padding: ${styleGuide.spacing.lg};`);
    expect(html).toContain(`border-radius: ${styleGuide.radii.md};`);
  });

  it('injects raw customCss even without a StyleGuide', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    content.namedElements![card.id] = { ...content.namedElements![card.id], customCss: 'letter-spacing: 0.04em;' };

    const html = renderPage(content);
    expect(html).toContain('<style data-fp-element-overrides>');
    expect(html).toContain(`[data-element-id="${card.id}"] { letter-spacing: 0.04em; }`);
  });

  it('produces no overrides block when no element has overrides', () => {
    const content = ingestCardsPage();
    const html = renderPage(content);
    expect(html).not.toContain('data-fp-element-overrides');
  });

  it('renders the theme stylesheet before element overrides even for a fragment template (no </head>)', () => {
    const content = ingestCardsPage();
    const fragmentContent = { ...content, template: content.template.replace(/<\/?head>|<title>.*?<\/title>/g, '') };
    const card = Object.values(fragmentContent.namedElements!).find((el) => el.type === 'InfoCard')!;
    fragmentContent.namedElements = {
      ...fragmentContent.namedElements,
      [card.id]: { ...fragmentContent.namedElements![card.id], styleOverrides: { padding: 'lg' } },
    };
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');

    const html = renderPage(fragmentContent, styleGuide);
    const themeIndex = html.indexOf('data-fp-theme');
    const overridesIndex = html.indexOf('data-fp-element-overrides');
    expect(themeIndex).toBeGreaterThan(-1);
    expect(overridesIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeLessThan(overridesIndex);
  });
});

describe('generateElementOverrides', () => {
  it('escapes < in customCss so a persisted value can never break out of the <style> block', () => {
    const namedElements: Record<string, NamedElement> = {
      'InfoCard-1-p1': {
        id: 'InfoCard-1-p1',
        type: 'InfoCard',
        index: 1,
        pageNumber: 1,
        containerId: 'c-1',
        customCss: 'content: "</style><script>";',
        source: 'heuristic',
      },
    };
    const css = generateElementOverrides(namedElements);
    expect(css).not.toContain('<');
    expect(css).toContain('\\3c ');
  });

  it('skips structured style overrides when no StyleGuide is given', () => {
    const namedElements: Record<string, NamedElement> = {
      'InfoCard-1-p1': {
        id: 'InfoCard-1-p1',
        type: 'InfoCard',
        index: 1,
        pageNumber: 1,
        containerId: 'c-1',
        styleOverrides: { padding: 'lg' },
        source: 'heuristic',
      },
    };
    expect(generateElementOverrides(namedElements)).toBe('');
  });

  it('skips an unresolvable token name rather than emitting invalid CSS', () => {
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');
    const namedElements: Record<string, NamedElement> = {
      'InfoCard-1-p1': {
        id: 'InfoCard-1-p1',
        type: 'InfoCard',
        index: 1,
        pageNumber: 1,
        containerId: 'c-1',
        styleOverrides: { padding: 'not-a-real-token' },
        source: 'heuristic',
      },
    };
    expect(generateElementOverrides(namedElements, styleGuide)).toBe('');
  });

  it('still emits a declaration when a token legitimately resolves to an empty string', () => {
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');
    styleGuide.shadows.sm = '';
    const namedElements: Record<string, NamedElement> = {
      'InfoCard-1-p1': {
        id: 'InfoCard-1-p1',
        type: 'InfoCard',
        index: 1,
        pageNumber: 1,
        containerId: 'c-1',
        styleOverrides: { shadow: 'sm' },
        source: 'heuristic',
      },
    };
    expect(generateElementOverrides(namedElements, styleGuide)).toBe('[data-element-id="InfoCard-1-p1"] { box-shadow: ; }');
  });
});
