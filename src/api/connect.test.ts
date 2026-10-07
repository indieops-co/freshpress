import { describe, it, expect, vi } from 'vitest';
import type { PageContent, ContentSlot } from '../content/types.js';
import type { Site, SitePage } from '../storage/types.js';
import type { PublishedSnapshot } from '../publish/service.js';

// renderPage is the hash input; mock it to echo the content so a slot change moves the hash.
vi.mock('../content/render.js', () => ({
  renderPage: (content: unknown) => JSON.stringify(content),
  generateElementOverrides: () => '',
}));

const {
  hashRendered,
  firstTextExcerpt,
  deriveParentSlug,
  buildPageFragment,
  buildManifest,
  buildPagePayload,
  computeConnectorDrift,
  connectorRateLimitKey,
  makeConnectorRateLimiter,
} = await import('./connect.js');

const { ConnectorSyncReportSchema } = await import('../storage/connector-sync-reports.js');

const slot = (over: Partial<ContentSlot>): ContentSlot => ({
  id: 's',
  type: 'text',
  value: 'x',
  tag: 'p',
  path: '',
  ...over,
});

const content = (slots: Record<string, ContentSlot>): PageContent => ({
  template: '',
  slots,
  slotOrder: Object.keys(slots),
});

const page = (over: Partial<SitePage>): SitePage => ({
  id: 'p1',
  path: '/',
  title: 'Home',
  content: content({}),
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const site = (pages: SitePage[]): Site => ({
  meta: { id: 'site1', name: 'Acme', createdAt: '', updatedAt: '' },
  pages,
});

const PUBLISHED_AT = '2026-02-01T00:00:00Z';

const snapshot = (pages: Record<string, PageContent>): PublishedSnapshot => ({
  record: {
    id: 'pub1',
    siteId: 'site1',
    label: 'Publish',
    createdAt: PUBLISHED_AT,
    pageCount: Object.keys(pages).length,
    bundlePath: '',
  },
  pages,
});

describe('hashRendered', () => {
  it('is stable for equal input and differs for different input', () => {
    expect(hashRendered('abc')).toBe(hashRendered('abc'));
    expect(hashRendered('abc')).not.toBe(hashRendered('abd'));
  });
});

describe('firstTextExcerpt', () => {
  it('skips non-text slots, collapses whitespace, picks the first text slot', () => {
    const c = content({
      a: slot({ id: 'a', type: 'image', value: '/img.png' }),
      b: slot({ id: 'b', type: 'text', value: '  Hello   world  ' }),
    });
    expect(firstTextExcerpt(c)).toBe('Hello world');
  });

  it('truncates with an ellipsis past the max', () => {
    const long = 'A'.repeat(200);
    const c = content({ b: slot({ id: 'b', type: 'text', value: long }) });
    const out = firstTextExcerpt(c, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty string when there is no text slot', () => {
    expect(firstTextExcerpt(content({ a: slot({ id: 'a', type: 'image', value: '/x.png' }) }))).toBe('');
  });
});

describe('deriveParentSlug', () => {
  const services = page({ id: 'svc', path: '/services', title: 'Services' });

  it('returns null for the home page and for top-level pages', () => {
    expect(deriveParentSlug(page({ path: '/' }), [])).toBeNull();
    expect(deriveParentSlug(page({ path: '/about' }), [])).toBeNull();
  });

  it('resolves a nested path to its parent page slug', () => {
    const child = page({ id: 'plb', path: '/services/plumbing', title: 'Plumbing' });
    expect(deriveParentSlug(child, [services, child])).toBe('services');
  });

  it('returns null when the parent page does not exist', () => {
    const orphan = page({ id: 'o', path: '/services/plumbing', title: 'Plumbing' });
    expect(deriveParentSlug(orphan, [orphan])).toBeNull();
  });
});

describe('buildPageFragment', () => {
  it('absolutizes root-relative URLs, collects deduped image assets, and hoists head styles', () => {
    const rendered =
      '<html><head><style>.x{color:red}</style></head><body>' +
      '<img src="/media/site1/hero.png" alt="Hero">' +
      '<img src="/media/site1/hero.png" alt="Hero">' +
      '<a href="/about">About</a></body></html>';
    const { html, assets } = buildPageFragment(rendered, 'https://app.example');

    expect(html).toContain('<style>.x{color:red}</style>');
    expect(html).toContain('src="https://app.example/media/site1/hero.png"');
    expect(html).toContain('href="https://app.example/about"');
    expect(assets).toEqual([{ url: 'https://app.example/media/site1/hero.png', alt: 'Hero' }]);
  });

  it('handles a bare fragment (no head/body) by returning its content', () => {
    const { html, assets } = buildPageFragment('<div>hi</div>', 'https://app.example');
    expect(html).toContain('<div>hi</div>');
    expect(assets).toEqual([]);
  });
});

/** Drive a rate-limit middleware once; resolve allowed=true on next(), false on a sent response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runLimiter(mw: (req: any, res: any, next: () => void) => unknown, req: unknown): Promise<{ allowed: boolean; status: number }> {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      _h: {} as Record<string, unknown>,
      setHeader(k: string, v: unknown) { this._h[k.toLowerCase()] = v; },
      getHeader(k: string) { return this._h[k.toLowerCase()]; },
      removeHeader(k: string) { delete this._h[k.toLowerCase()]; },
      status(c: number) { this.statusCode = c; return this; },
      send() { resolve({ allowed: false, status: this.statusCode }); return this; },
      json() { resolve({ allowed: false, status: this.statusCode }); return this; },
      end() { resolve({ allowed: false, status: this.statusCode }); return this; },
    };
    Promise.resolve(mw(req, res, () => resolve({ allowed: true, status: 200 }))).catch(() =>
      resolve({ allowed: true, status: 200 })
    );
  });
}

describe('connector rate limiter', () => {
  it('keys on the token hash (IP-independent), falling back to IP when no bearer', () => {
    const k1 = connectorRateLimitKey({ headers: { authorization: 'Bearer abc' }, ip: '1.1.1.1' });
    const k2 = connectorRateLimitKey({ headers: { authorization: 'Bearer abc' }, ip: '2.2.2.2' });
    const noTok = connectorRateLimitKey({ headers: {}, ip: '3.3.3.3' });
    expect(k1).toBe(k2);
    expect(k1.startsWith('t:')).toBe(true);
    expect(noTok).toBe('ip:3.3.3.3');
  });

  it('allows up to max per token, then 429s — independently per token', async () => {
    const mw = makeConnectorRateLimiter({ max: 2 });
    const reqA = () => ({ headers: { authorization: 'Bearer AAA' }, ip: '1.1.1.1', method: 'GET', app: { get: () => undefined } });
    const reqB = () => ({ headers: { authorization: 'Bearer BBB' }, ip: '1.1.1.1', method: 'GET', app: { get: () => undefined } });
    expect((await runLimiter(mw, reqA())).allowed).toBe(true);
    expect((await runLimiter(mw, reqA())).allowed).toBe(true);
    const blocked = await runLimiter(mw, reqA());
    expect(blocked.allowed).toBe(false);
    expect(blocked.status).toBe(429);
    expect((await runLimiter(mw, reqB())).allowed).toBe(true); // different token unaffected
  });
});

describe('computeConnectorDrift', () => {
  it('is behind when the latest publish is newer than the last pull', () => {
    const d = computeConnectorDrift('2026-02-02T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(d.behind).toBe(true);
    expect(d.lastPublishedAt).toBe('2026-02-02T00:00:00Z');
    expect(d.lastPulledAt).toBe('2026-02-01T00:00:00Z');
  });

  it('is not behind when the last pull is at or after the latest publish', () => {
    expect(computeConnectorDrift('2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z').behind).toBe(false);
    expect(computeConnectorDrift('2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z').behind).toBe(false);
  });

  it('is never behind before the first pull or the first publish', () => {
    expect(computeConnectorDrift('2026-02-01T00:00:00Z', null).behind).toBe(false); // never pulled
    expect(computeConnectorDrift(null, '2026-02-01T00:00:00Z').behind).toBe(false); // never published
    expect(computeConnectorDrift(null, null).behind).toBe(false);
  });
});

describe('ConnectorSyncReportSchema', () => {
  const valid = { ran_at: '2026-02-01T00:00:00Z', ok: true, site: 'Acme', created: 1, updated: 2, skipped: 3, drafted: 0, errors: 0 };

  it('accepts a well-formed report and strips unknown keys (forward-compatible)', () => {
    const parsed = ConnectorSyncReportSchema.parse({ ...valid, futureField: 'ignored' });
    expect(parsed.created).toBe(1);
    expect('futureField' in parsed).toBe(false);
  });

  it('defaults missing counts to 0 and rejects a missing ok/ran_at', () => {
    const parsed = ConnectorSyncReportSchema.parse({ ran_at: 't', ok: false });
    expect(parsed.created).toBe(0);
    expect(ConnectorSyncReportSchema.safeParse({ ok: true }).success).toBe(false);
    expect(ConnectorSyncReportSchema.safeParse({ ran_at: 't' }).success).toBe(false);
  });

  it('rejects out-of-range counts and oversized strings', () => {
    expect(ConnectorSyncReportSchema.safeParse({ ...valid, created: -1 }).success).toBe(false);
    expect(ConnectorSyncReportSchema.safeParse({ ...valid, created: 9_999_999 }).success).toBe(false);
    expect(ConnectorSyncReportSchema.safeParse({ ...valid, error: 'x'.repeat(600) }).success).toBe(false);
  });
});

describe('manifest from the published snapshot', () => {
  const publishedContent = content({ t: slot({ id: 't', type: 'text', value: 'PUBLISHED' }) });
  const draftContent = content({ t: slot({ id: 't', type: 'text', value: 'DRAFT' }) });
  const p = page({ id: 'p1', path: '/', content: draftContent });

  it('produces the same content_hash in the manifest and the page payload', () => {
    const snap = snapshot({ p1: publishedContent });
    const m = buildManifest(site([p]), snap, undefined, 'https://app.example');
    const payload = buildPagePayload('p1', snap.pages.p1, undefined, 'https://app.example');
    expect(m.pages[0].content_hash).toBe(payload.content_hash);
  });

  it('hashes and excerpts the snapshot content, not the working copy', () => {
    const m = buildManifest(site([p]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    const fromDraft = buildManifest(site([p]), snapshot({ p1: draftContent }), undefined, 'https://app.example');
    expect(m.pages[0].excerpt).toBe('PUBLISHED');
    expect(m.pages[0].content_hash).not.toBe(fromDraft.pages[0].content_hash);
  });

  it('changes the hash when the published slot value changes', () => {
    const m1 = buildManifest(site([p]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    const m2 = buildManifest(
      site([p]),
      snapshot({ p1: content({ t: slot({ id: 't', type: 'text', value: 'PUBLISHED v2' }) }) }),
      undefined,
      'https://app.example'
    );
    expect(m2.pages[0].content_hash).not.toBe(m1.pages[0].content_hash);
  });

  it('stamps updated_at with the publish time, not the page updatedAt', () => {
    const m = buildManifest(site([p]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    expect(m.pages[0].updated_at).toBe(PUBLISHED_AT);
    expect(m.site.last_published_at).toBe(PUBLISHED_AT);
  });

  it('omits working-copy pages missing from the snapshot (created after last publish)', () => {
    const newPage = page({ id: 'p2', path: '/new', title: 'New' });
    const m = buildManifest(site([p, newPage]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    expect(m.pages.map((x) => x.id)).toEqual(['p1']);
  });

  it('omits snapshot pages deleted from the working copy since last publish', () => {
    const m = buildManifest(
      site([p]),
      snapshot({ p1: publishedContent, ghost: draftContent }),
      undefined,
      'https://app.example'
    );
    expect(m.pages.map((x) => x.id)).toEqual(['p1']);
  });

  it('returns an empty manifest with last_published_at null for a never-published site', () => {
    const m = buildManifest(site([p]), null, undefined, 'https://app.example');
    expect(m.pages).toEqual([]);
    expect(m.site.last_published_at).toBeNull();
  });

  it('marks the root page as home, slugs it "home", exposes path + contact endpoint', () => {
    const m = buildManifest(site([p]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    expect(m.pages[0].is_home).toBe(true);
    expect(m.pages[0].slug).toBe('home');
    expect(m.pages[0].path).toBe('/');
    expect(m.site.contact_endpoint).toBe('https://app.example/api/public/sites/site1/contact');
  });

  it('falls back seo_title→title and seo_description→excerpt when no per-page SEO is set', () => {
    const m = buildManifest(site([p]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    expect(m.pages[0].seo_title).toBe('Home');
    expect(m.pages[0].seo_description).toBe('PUBLISHED');
  });

  it('uses per-page SEO overrides when present (read from the working copy, not the snapshot)', () => {
    const withSeo = page({
      id: 'p1',
      path: '/',
      content: draftContent,
      seo: { title: 'Custom Title', description: 'Custom description' },
    });
    const m = buildManifest(site([withSeo]), snapshot({ p1: publishedContent }), undefined, 'https://app.example');
    expect(m.pages[0].seo_title).toBe('Custom Title');
    expect(m.pages[0].seo_description).toBe('Custom description');
  });

  it('carries the FreshPress page path for internal-link mapping', () => {
    const svc = page({ id: 'svc', path: '/services', title: 'Services', content: draftContent });
    const child = page({ id: 'plb', path: '/services/plumbing', title: 'Plumbing', content: draftContent });
    const m = buildManifest(
      site([p, svc, child]),
      snapshot({ p1: publishedContent, svc: publishedContent, plb: publishedContent }),
      undefined,
      'https://app.example'
    );
    const byId = Object.fromEntries(m.pages.map((x) => [x.id, x]));
    expect(byId.plb.path).toBe('/services/plumbing');
    expect(byId.plb.parent_slug).toBe('services');
  });
});
