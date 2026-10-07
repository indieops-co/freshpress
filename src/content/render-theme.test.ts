import { describe, expect, it } from 'vitest';
import { renderPage, injectStyleGuide } from './render.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';
import type { PageContent } from './types.js';

const guide = buildDefaultStyleGuide('test', 'Test Theme', 'Testing Aesthetic');

const fullDocContent: PageContent = {
  template: '<html><head><title>T</title></head><body><h1>{{slot:hero}}</h1></body></html>',
  slots: { hero: { id: 'hero', type: 'text', value: 'Hello', tag: 'h1', path: 'body>h1' } },
  slotOrder: ['hero'],
};

const fragmentContent: PageContent = {
  template: '<section><h1>{{slot:hero}}</h1></section>',
  slots: { hero: { id: 'hero', type: 'text', value: 'Hello', tag: 'h1', path: 'body>h1' } },
  slotOrder: ['hero'],
};

describe('renderPage with a StyleGuide', () => {
  it('renders unchanged when no guide is passed', () => {
    const html = renderPage(fullDocContent);
    expect(html).not.toContain('data-fp-theme');
    expect(html).toContain('<h1>Hello</h1>');
  });

  it('injects the stylesheet into <head> and tags <body> with fp-page', () => {
    const html = renderPage(fullDocContent, guide);
    expect(html).toContain('<style data-fp-theme>');
    expect(html).toContain('.fp-page h1 {');
    expect(html).toMatch(/<style data-fp-theme>[\s\S]*<\/style>\s*<\/head>/);
    expect(html).toContain('<body class="fp-page">');
    expect(html).toContain('<h1>Hello</h1>');
  });

  it('wraps fragments in an fp-page div with the style prepended', () => {
    const html = renderPage(fragmentContent, guide);
    expect(html).toContain('<style data-fp-theme>');
    expect(html).toContain('<div class="fp-page">');
    expect(html).toContain('<h1>Hello</h1>');
  });
});

describe('injectStyleGuide', () => {
  it('prepends fp-page to an existing body class attribute', () => {
    const html = injectStyleGuide('<html><head></head><body class="dark home">x</body></html>', guide);
    expect(html).toContain('<body class="fp-page dark home">');
  });

  it('preserves other body attributes', () => {
    const html = injectStyleGuide('<html><head></head><body id="top">x</body></html>', guide);
    expect(html).toContain('<body id="top" class="fp-page">');
  });
});
