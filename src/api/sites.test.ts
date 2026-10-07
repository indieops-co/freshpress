import { describe, it, expect } from 'vitest';
import { prepareGeneratedPages } from './sites.js';
import { buildGeneratedPage, selectIncludedSections } from '../ai/generate-page-content.js';
import { selectScaffold } from '../design/section-patterns.js';
import { flattenContainers } from '../content/containers.js';
import type { PageContent } from '../content/types.js';

const saas = selectScaffold('saas').scaffold;
const generatedPage = (pageNumber = 1): PageContent =>
  buildGeneratedPage(
    selectIncludedSections(saas, {
      sections: saas.sections.map((s) => ({ id: s.id, include: true, fields: {}, items: [] })),
    }),
    pageNumber
  );

const pageInput = (path = '/', title = 'Home', content = generatedPage()) => ({ path, title, content });
const existingPage = (path: string, content: PageContent = generatedPage(1)) => ({
  id: `id-${path}`,
  path,
  title: path,
  content,
});

// Deep clone so a mutation in one test never leaks into another.
const clone = (p: PageContent): PageContent => JSON.parse(JSON.stringify(p));

/**
 * The apply endpoint's validate-then-prepare core (Chunk 9): a malformed
 * generation must never be persisted, generated element data is authoritative
 * (never re-derived), path conflicts with the site are a 409 (append-only +
 * retry-safe), and -pN element ids are reconciled against the FINAL
 * path-sorted position in site.pages — including existing pages a new page
 * displaces.
 */
describe('prepareGeneratedPages', () => {
  it('accepts a real generated page and preserves its content untouched on an empty site', () => {
    const input = pageInput();
    const result = prepareGeneratedPages([input], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPages).toHaveLength(1);
    expect(result.existingUpdates).toHaveLength(0);
    // Position 1 on an empty site — the generator already numbered it p1, so nothing changes.
    expect(result.newPages[0].content).toEqual(input.content);
    expect(Object.keys(result.newPages[0].content.namedElements!).every((id) => id.endsWith('-p1'))).toBe(true);
  });

  it('renumbers element ids to the final path-sorted positions and remaps container back-references', () => {
    // Existing '/about' and '/contact' sort ahead of the new '/x' and '/z'.
    const result = prepareGeneratedPages(
      [pageInput('/x', 'X'), pageInput('/z', 'Z')],
      [existingPage('/about'), existingPage('/contact', generatedPage(2))]
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [x, z] = result.newPages;
    expect(x.path).toBe('/x');
    expect(Object.keys(x.content.namedElements!).every((id) => id.endsWith('-p3'))).toBe(true);
    expect(Object.keys(z.content.namedElements!).every((id) => id.endsWith('-p4'))).toBe(true);
    expect(Object.values(x.content.namedElements!).every((el) => el.pageNumber === 3)).toBe(true);
    // Existing pages already sit at positions 1–2 with matching ids — untouched.
    expect(result.existingUpdates).toHaveLength(0);

    // Container elementId refs must follow the renamed ids (no dangling back-refs).
    for (const page of result.newPages) {
      const elements = page.content.namedElements!;
      for (const c of flattenContainers(page.content.containers!)) {
        if (c.elementId) expect(elements[c.elementId]).toBeDefined();
      }
    }
  });

  it('renumbers an existing page a new page displaces (site.pages is path-sorted, not append-ordered)', () => {
    // New '/' sorts ahead of existing '/blog', pushing it from position 1 to 2.
    const blog = existingPage('/blog', generatedPage(1));
    const result = prepareGeneratedPages([pageInput('/', 'Home')], [blog]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.newPages[0].content.namedElements!).every((id) => id.endsWith('-p1'))).toBe(true);
    expect(result.existingUpdates).toHaveLength(1);
    expect(result.existingUpdates[0].id).toBe(blog.id);
    expect(Object.keys(result.existingUpdates[0].content.namedElements!).every((id) => id.endsWith('-p2'))).toBe(true);
    // The caller's original page object is not mutated.
    expect(Object.keys(blog.content.namedElements!).every((id) => id.endsWith('-p1'))).toBe(true);
  });

  it('rejects a path that already exists on the site with 409 (append-only, retry-safe)', () => {
    const result = prepareGeneratedPages([pageInput('/', 'Home')], [existingPage('/')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toContain('already exists');
  });

  it('rejects the whole batch when any page fails Guardian validation (all-or-nothing, 422)', () => {
    const bad = clone(generatedPage());
    bad.slotOrder = bad.slotOrder.slice(1);
    const result = prepareGeneratedPages([pageInput('/', 'Home'), pageInput('/broken', 'Broken', bad)], []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    // Errors name the offending page so a multi-page apply is debuggable.
    expect(result.errors.some((e) => e.startsWith('pages[1] (/broken):'))).toBe(true);
    expect(result.errors.some((e) => e.startsWith('pages[0]'))).toBe(false);
  });

  it('rejects malformed request shapes with 400', () => {
    const cases: unknown[] = [
      undefined,
      'not-an-array',
      [],
      [{ path: 'no-slash', title: 'T', content: generatedPage() }],
      [{ path: '/', title: '  ', content: generatedPage() }],
      [{ path: '/', title: 'T' }],
      [{ path: '/', title: 'T', content: ['not', 'an', 'object'] }],
      [null],
    ];
    for (const input of cases) {
      const result = prepareGeneratedPages(input, []);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });

  it('rejects duplicate paths within one batch', () => {
    const result = prepareGeneratedPages([pageInput('/', 'A'), pageInput('/', 'B')], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('more than once');
  });
});
