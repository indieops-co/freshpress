import { describe, it, expect } from 'vitest';
import { validateGeneratedPage } from './validate-generated-page.js';
import { buildGeneratedPage, selectIncludedSections } from '../ai/generate-page-content.js';
import { selectScaffold } from '../design/section-patterns.js';
import type { PageContent } from '../content/types.js';

const saas = selectScaffold('saas').scaffold;
const validPage = (): PageContent =>
  buildGeneratedPage(
    selectIncludedSections(saas, {
      sections: saas.sections.map((s) => ({ id: s.id, include: true, fields: {}, items: [] })),
    }),
    1
  );

// Deep clone so a mutation in one test never leaks into another.
const clone = (p: PageContent): PageContent => JSON.parse(JSON.stringify(p));

describe('validateGeneratedPage', () => {
  it('accepts a real generated page', () => {
    const r = validateGeneratedPage(validPage());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a template placeholder with no matching slot (dangling ref)', () => {
    const p = clone(validPage());
    p.template = p.template.replace('</body>', '<p>{{slot:ghost}}</p></body>');
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('rejects a slot with no placeholder in the template (orphan slot)', () => {
    const p = clone(validPage());
    const id = 'orphan-1';
    p.slots[id] = { id, type: 'text', value: 'x', tag: 'p', path: 'p[9]' };
    p.slotOrder.push(id);
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('orphan-1') && e.includes('placeholder'))).toBe(true);
  });

  it('rejects a slotOrder / slots mismatch', () => {
    const p = clone(validPage());
    p.slotOrder = p.slotOrder.slice(1); // drop one id from the order
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('not in slotOrder'))).toBe(true);
  });

  it('rejects a named element whose source is not "generated"', () => {
    const p = clone(validPage());
    const first = Object.keys(p.namedElements!)[0];
    (p.namedElements![first] as { source: string }).source = 'heuristic';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('source "generated"'))).toBe(true);
  });

  it('rejects a named element referencing a missing container', () => {
    const p = clone(validPage());
    const first = Object.keys(p.namedElements!)[0];
    p.namedElements![first].containerId = 'c-does-not-exist';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('missing container'))).toBe(true);
  });

  it('rejects a container path that no longer resolves in the template (unstampable)', () => {
    const p = clone(validPage());
    // Corrupt a non-root container's path so injectElementIds can't stamp it.
    const child = p.containers![0].children[0];
    child.path = 'section[99]';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('unstampable'))).toBe(true);
  });

  it('rejects a page missing containers/namedElements entirely', () => {
    const p = clone(validPage());
    delete p.containers;
    delete p.namedElements;
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('containers'))).toBe(true);
    expect(r.errors.some((e) => e.includes('namedElements'))).toBe(true);
  });

  it('rejects a malformed named-element id (not {Type}-{index}-p{page})', () => {
    const p = clone(validPage());
    const els = p.namedElements!;
    const [oldId, el] = Object.entries(els)[0];
    delete els[oldId];
    els['broken-id'] = { ...el, id: 'broken-id' };
    // Keep the container back-reference consistent so THIS error is the one under test.
    p.containers![0].elementId = 'broken-id';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('well-formed'))).toBe(true);
  });

  it('rejects a duplicate {{slot:id}} placeholder in the template', () => {
    const p = clone(validPage());
    const id = p.slotOrder[0];
    // Inject a second copy of an existing placeholder.
    p.template = p.template.replace('</body>', `<p>{{slot:${id}}}</p></body>`);
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('duplicate slot placeholders'))).toBe(true);
  });

  it('rejects an invalid slot type', () => {
    const p = clone(validPage());
    const id = Object.keys(p.slots)[0];
    (p.slots[id] as { type: string }).type = 'widget';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('invalid type'))).toBe(true);
  });

  // Save-time -pN reconciliation rebuilds ids FROM type/index/pageNumber, so a
  // page whose fields disagree with its ids would corrupt or collide only AFTER
  // this validator approved it — these three checks close that gap.

  it('rejects fields that do not round-trip to the element id', () => {
    const p = clone(validPage());
    const first = Object.keys(p.namedElements!)[0];
    p.namedElements![first].pageNumber = 7;
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('round-trip'))).toBe(true);
  });

  it('rejects malformed type/index/pageNumber fields', () => {
    const p = clone(validPage());
    const first = Object.keys(p.namedElements!)[0];
    (p.namedElements![first] as { index: unknown }).index = 'one';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('malformed type/index/pageNumber'))).toBe(true);
  });

  it('rejects two elements sharing (type, index) — a renumber-time id collision', () => {
    const p = clone(validPage());
    const entries = Object.entries(p.namedElements!);
    const [, first] = entries[0];
    // A second element with the same (type, index) but claiming another page:
    // both would rebuild to the same id when reconciled onto one page.
    const impostorId = `${first.type}-${first.index}-p9`;
    p.namedElements![impostorId] = { ...clone(validPage()).namedElements![entries[1][0]], ...{ id: impostorId, type: first.type, index: first.index, pageNumber: 9 } };
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('collide on renumber'))).toBe(true);
  });

  it('rejects customCss that fails the CSS Guardian (style-breakout, braces)', () => {
    const p = clone(validPage());
    const first = Object.keys(p.namedElements!)[0];
    p.namedElements![first].customCss = 'color: red } </style><script>alert(1)</script>';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('customCss'))).toBe(true);
  });

  it('accepts benign customCss', () => {
    const p = clone(validPage());
    const first = Object.keys(p.namedElements!)[0];
    p.namedElements![first].customCss = 'letter-spacing: 0.02em; text-transform: uppercase;';
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(true);
  });

  // Scaffold templates are code-serialized (class/href attrs only), so script
  // content in a template can only mean a handcrafted payload aimed at the
  // apply endpoint — reject all three vectors.
  it.each([
    ['<script> tag', '<script>alert(1)</script>'],
    ['javascript: URL', '<a href="javascript:alert(1)">x</a>'],
    ['inline event handler', '<div onclick="alert(1)">x</div>'],
  ])('rejects a template carrying %s', (_label, payload) => {
    const p = clone(validPage());
    p.template = p.template.replace('</body>', `${payload}</body>`);
    const r = validateGeneratedPage(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('script content'))).toBe(true);
  });
});
