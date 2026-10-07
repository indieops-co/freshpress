import { describe, expect, it } from 'vitest';
import { ingestHtml } from '../ingest/index.js';
import { deriveContainers, findContainer, flattenContainers, subtreeSlotIds } from './containers.js';
import {
  allocateNamedElements,
  deriveIfMissing,
  deriveNamedElements,
  formatElementId,
  normalizeElementType,
  parseElementId,
  reconcilePageNumbers,
  resolveElementType,
  resolveElementScope,
} from './named-elements.js';
import type { NamedElement } from './types.js';

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Acme Plumbing</title></head>
<body>
  <header><h2>Acme</h2><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <section>
    <h1>Fast, friendly plumbing</h1>
    <p>Serving the metro area since 1998.</p>
    <a href="/quote">Get a quote</a>
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

function ingestSample() {
  return ingestHtml('https://acme.example/', SAMPLE_HTML).content;
}

describe('deriveContainers', () => {
  const content = ingestSample();
  const roots = deriveContainers(content);
  const all = flattenContainers(roots);

  it('produces a single Page root', () => {
    expect(roots).toHaveLength(1);
    expect(roots[0].suggestedType).toBe('Page');
    expect(roots[0].tag).toBe('body');
  });

  it('detects semantic landmarks', () => {
    const types = all.map((c) => c.suggestedType);
    expect(types).toContain('Header');
    expect(types).toContain('Nav');
    expect(types).toContain('Footer');
  });

  it('marks the first h1-bearing section as HeroSection', () => {
    const hero = all.find((c) => c.suggestedType === 'HeroSection');
    expect(hero).toBeDefined();
    expect(subtreeSlotIds(hero!).some((id) => content.slots[id]?.tag === 'h1')).toBe(true);
  });

  it('detects repeated siblings as InfoCards under a FeatureGrid', () => {
    const cards = all.filter((c) => c.suggestedType === 'InfoCard');
    expect(cards).toHaveLength(3);
    const grid = all.find((c) => c.suggestedType === 'FeatureGrid');
    expect(grid).toBeDefined();
    expect(grid!.children.filter((c) => c.suggestedType === 'InfoCard')).toHaveLength(3);
  });

  it('assigns each slot to exactly one container (no double-claiming)', () => {
    const seen = new Map<string, number>();
    for (const node of all) {
      for (const id of node.slotIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const [slotId, count] of seen) {
      expect(count, `slot ${slotId} claimed ${count} times`).toBe(1);
    }
    expect([...seen.keys()].sort()).toEqual([...content.slotOrder].sort());
  });
});

describe('allocateNamedElements', () => {
  it('assigns {Type}-{index}-p{page} ids with 1-based per-type indexes', () => {
    const content = deriveNamedElements(ingestSample(), 1);
    const elements = Object.values(content.namedElements!);
    const cards = elements.filter((e) => e.type === 'InfoCard').sort((a, b) => a.index - b.index);
    expect(cards.map((e) => e.id)).toEqual(['InfoCard-1-p1', 'InfoCard-2-p1', 'InfoCard-3-p1']);
    const hero = elements.find((e) => e.type === 'HeroSection');
    expect(hero?.id).toBe('HeroSection-1-p1');
  });

  it('links containers to their elements bidirectionally', () => {
    const content = deriveNamedElements(ingestSample(), 1);
    for (const el of Object.values(content.namedElements!)) {
      const container = findContainer(content.containers!, el.containerId);
      expect(container?.elementId).toBe(el.id);
    }
  });

  it('preserves existing allocations and leaves gaps on delete', () => {
    const content = deriveNamedElements(ingestSample(), 1);
    const containers = content.containers!;
    // Simulate deletion of InfoCard-2 — its index must not be reused.
    const existing: Record<string, NamedElement> = { ...content.namedElements! };
    delete existing['InfoCard-2-p1'];
    const orphanContainerId = flattenContainers(containers).find(
      (c) => c.elementId === 'InfoCard-2-p1'
    )!.id;

    const fresh = deriveContainers(content);
    // Remove the middle card's container mapping by pretending its element never existed;
    // reallocation should give that container a NEW index (4), not resurrect 2.
    const result = allocateNamedElements(fresh, existing, 1);
    const reallocated = Object.values(result.namedElements).find(
      (e) => e.containerId === orphanContainerId
    );
    expect(reallocated?.id).toBe('InfoCard-4-p1');
    expect(result.namedElements['InfoCard-1-p1']).toBeDefined();
    expect(result.namedElements['InfoCard-3-p1']).toBeDefined();
    expect(result.namedElements['InfoCard-2-p1']).toBeUndefined();
  });
});

describe('deriveIfMissing', () => {
  it('derives once and is a no-op afterwards', () => {
    const first = deriveIfMissing(ingestSample(), 1);
    expect(first.namedElements).toBeDefined();
    const second = deriveIfMissing(first, 1);
    expect(second).toBe(first);
  });
});

describe('reconcilePageNumbers', () => {
  it('rewrites -pN suffixes when page order changes', () => {
    const pageA = { content: deriveNamedElements(ingestSample(), 1) };
    const pageB = { content: deriveNamedElements(ingestSample(), 2) };
    expect(Object.keys(pageB.content.namedElements!)).toContain('InfoCard-1-p2');

    const { pages, changed } = reconcilePageNumbers([pageB, pageA]);
    expect(changed).toBe(true);
    expect(Object.keys(pages[0].content.namedElements!)).toContain('InfoCard-1-p1');
    expect(Object.keys(pages[1].content.namedElements!)).toContain('InfoCard-1-p2');
    // Container refs remapped too.
    for (const page of pages) {
      for (const el of Object.values(page.content.namedElements!)) {
        const container = findContainer(page.content.containers!, el.containerId);
        expect(container?.elementId).toBe(el.id);
      }
    }
  });

  it('is a no-op when order is unchanged', () => {
    const pageA = { content: deriveNamedElements(ingestSample(), 1) };
    const { pages, changed } = reconcilePageNumbers([pageA]);
    expect(changed).toBe(false);
    expect(pages[0]).toBe(pageA);
  });

  it('preserves customCss through renumbering', () => {
    const content = deriveNamedElements(ingestSample(), 2);
    content.namedElements!['InfoCard-1-p2'] = {
      ...content.namedElements!['InfoCard-1-p2'],
      customCss: 'padding: 2rem;',
    };
    const { pages } = reconcilePageNumbers([{ content }]);
    expect(pages[0].content.namedElements!['InfoCard-1-p1'].customCss).toBe('padding: 2rem;');
  });
});

describe('taxonomy helpers', () => {
  it('normalizes and resolves types against core + discovered lists', () => {
    expect(normalizeElementType('service area map')).toBe('ServiceAreaMap');
    expect(resolveElementType('InfoCard')).toEqual({ type: 'InfoCard', isNew: false });
    expect(resolveElementType('service-area-map')).toEqual({ type: 'ServiceAreaMap', isNew: true });
    expect(resolveElementType('ServiceAreaMap', ['ServiceAreaMap'])).toEqual({
      type: 'ServiceAreaMap',
      isNew: false,
    });
  });

  it('round-trips element ids', () => {
    expect(parseElementId(formatElementId('InfoCard', 3, 2))).toEqual({
      type: 'InfoCard',
      index: 3,
      pageNumber: 2,
    });
    expect(parseElementId('not-an-id')).toBeNull();
  });
});

describe('resolveElementScope', () => {
  it('returns the element and its container subtree', () => {
    const content = deriveNamedElements(ingestSample(), 1);
    const scope = resolveElementScope(content, 'HeroSection-1-p1');
    expect(scope).not.toBeNull();
    expect(scope!.element.type).toBe('HeroSection');
    const slotTags = subtreeSlotIds(scope!.container).map((id) => content.slots[id]?.tag);
    expect(slotTags).toContain('h1');
  });

  it('returns null for unknown elements', () => {
    const content = deriveNamedElements(ingestSample(), 1);
    expect(resolveElementScope(content, 'Nope-1-p1')).toBeNull();
  });
});
