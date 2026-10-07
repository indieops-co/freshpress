import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import * as cheerio from 'cheerio';
import { getStorage } from '../storage/filesystem.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { renderPage } from '../content/render.js';
import { pageSlug } from '../wordpress/export.js';
import { generateStyleSheet, type StyleGuide } from '../design/style-guide.js';
import { requireOwner } from '../auth/middleware.js';
import { requireFeature } from '../auth/entitlements.js';
import { requireConnectorToken } from '../auth/connector.js';
import { getConnectorTokenStore } from '../storage/connector-tokens.js';
import { getConnectorSyncReportStore, ConnectorSyncReportSchema } from '../storage/connector-sync-reports.js';
import { getPublishedSnapshot, type PublishedSnapshot } from '../publish/service.js';
import { listPublishes } from '../publish/index.js';
import { routeParam } from '../util/params.js';
import type { Site, SitePage } from '../storage/types.js';
import type { PageContent } from '../content/types.js';

/**
 * Connect API — what the WordPress Connector plugin pulls. FreshPress stays the
 * source of truth; this is read-only, and it serves PUBLISHED content only: page
 * content comes from the latest publish's SiteVersion snapshot, never the working
 * copy, so unreviewed drafts can't reach a live WP site (the same guarantee the
 * review workflow gives every other publish channel). The per-page `html` and its
 * `content_hash` both come from the SAME renderPage() output, so the hash changes
 * iff the rendered page changes — that is what lets the plugin skip unchanged
 * pages. renderPage() is deterministic for a given (content, styleGuide).
 *
 * Caveats of snapshot re-rendering: the CURRENT style guide is applied (content is
 * snapshotted, design follows the latest guide — `design_system_version` exists
 * precisely so the plugin can cache-bust on design changes), and pages created
 * after the last publish appear only after the next publish.
 */

function appBase(): string {
  return (process.env.APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

export interface ManifestPage {
  id: string;
  slug: string;
  /** FreshPress page path (e.g. "/services/plumbing"). Lets the plugin map internal <a href> paths to WP permalinks. */
  path: string;
  title: string;
  type: 'page';
  is_home: boolean;
  parent_slug: string | null;
  content_hash: string;
  updated_at: string;
  excerpt: string;
  /** Per-page SEO title (falls back to `title`). */
  seo_title: string;
  /** Per-page SEO meta description (falls back to `excerpt`). */
  seo_description: string;
}

export interface Manifest {
  site: {
    id: string;
    name: string;
    generated_at: string;
    last_published_at: string | null;
    css_url: null;
    design_system_version: string | null;
    contact_endpoint: string;
    signup_endpoint: string;
  };
  pages: ManifestPage[];
}

export interface PagePayloadAsset {
  url: string;
  alt: string;
}

export interface PagePayload {
  id: string;
  content_hash: string;
  html: string;
  assets: PagePayloadAsset[];
}

export function hashRendered(rendered: string): string {
  return createHash('sha256').update(rendered).digest('hex');
}

export function renderAndHash(content: PageContent, guide?: StyleGuide): { rendered: string; hash: string } {
  const rendered = renderPage(content, guide);
  return { rendered, hash: hashRendered(rendered) };
}

/** First non-empty text slot, whitespace-collapsed and truncated — SEO/excerpt fallback (no SEO is stored yet). */
export function firstTextExcerpt(content: PageContent, max = 160): string {
  for (const slot of Object.values(content.slots)) {
    if (slot.type === 'text' && slot.value.trim()) {
      const text = slot.value.replace(/\s+/g, ' ').trim();
      return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
    }
  }
  return '';
}

/** DERIVED hierarchy: /services/plumbing → parent /services. No parent_id is modeled in FreshPress. */
export function deriveParentSlug(page: SitePage, pages: SitePage[]): string | null {
  if (page.path === '/') return null;
  const segments = page.path.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const parentPath = `/${segments.slice(0, -1).join('/')}`;
  const parent = pages.find((p) => p.path === parentPath);
  return parent ? pageSlug(parent) : null;
}

/** A short version stamp for the design system — changes when the stylesheet changes (WP cache-busting). */
export function designSystemVersion(guide?: StyleGuide): string | null {
  if (!guide) return null;
  return hashRendered(generateStyleSheet(guide)).slice(0, 12);
}

/**
 * Turn renderPage() output into a self-contained fragment safe to echo inside a
 * WordPress page body: root-relative asset URLs absolutized against APP_URL, image
 * assets collected for sideloading, and — whether the render is a full document or
 * a fragment — head <style>/<link> hoisted in front of the body so the design
 * survives when there is no <head> to inject into on the WP side.
 */
export function buildPageFragment(rendered: string, base: string): { html: string; assets: PagePayloadAsset[] } {
  const $ = cheerio.load(rendered);

  $('[src], [href]').each((_, el) => {
    const $el = $(el);
    for (const attr of ['src', 'href'] as const) {
      const v = $el.attr(attr);
      if (v && v.startsWith('/')) $el.attr(attr, `${base}${v}`);
    }
  });

  const seen = new Set<string>();
  const assets: PagePayloadAsset[] = [];
  $('img[src]').each((_, el) => {
    const url = $(el).attr('src');
    if (!url || seen.has(url)) return;
    seen.add(url);
    assets.push({ url, alt: $(el).attr('alt') ?? '' });
  });

  const headStyles = $('head')
    .find('style, link[rel="stylesheet"]')
    .map((_, el) => $.html(el))
    .get()
    .join('\n');
  const body = $('body').html() ?? '';
  const html = headStyles ? `${headStyles}\n${body}` : body;

  return { html, assets };
}

/**
 * Manifest of the site's PUBLISHED pages. A page appears iff it exists in the
 * working copy (source of slug/title/hierarchy metadata) AND in the published
 * snapshot (source of the content that is hashed and excerpted). Pages deleted
 * since the last publish are omitted; a never-published site gets an empty list.
 */
export function buildManifest(
  site: Site,
  snapshot: PublishedSnapshot | null,
  guide: StyleGuide | undefined,
  base: string
): Manifest {
  const pages: ManifestPage[] = !snapshot
    ? []
    : site.pages
        .filter((page) => snapshot.pages[page.id])
        .map((page) => {
          const content = snapshot.pages[page.id];
          const { hash } = renderAndHash(content, guide);
          const excerpt = firstTextExcerpt(content);
          return {
            id: page.id,
            slug: pageSlug(page),
            path: page.path,
            title: page.title,
            type: 'page' as const,
            is_home: page.path === '/',
            parent_slug: deriveParentSlug(page, site.pages),
            // Publish time, not page.updatedAt — the working copy may have moved on.
            content_hash: hash,
            updated_at: snapshot.record.createdAt,
            excerpt,
            // SEO lives on the working-copy SitePage, not the PageContent snapshot
            // (SiteVersion.pages stores PageContent only) — so it reads from `page`,
            // exactly like title/slug/path already do. Falls back to title/excerpt.
            seo_title: page.seo?.title?.trim() || page.title,
            seo_description: page.seo?.description?.trim() || excerpt,
          };
        });

  return {
    site: {
      id: site.meta.id,
      name: site.meta.name,
      generated_at: new Date().toISOString(),
      last_published_at: snapshot?.record.createdAt ?? null,
      css_url: null, // design ships inline per page via renderPage()
      design_system_version: designSystemVersion(guide),
      contact_endpoint: `${base}/api/public/sites/${site.meta.id}/contact`,
      signup_endpoint: `${base}/api/public/sites/${site.meta.id}/subscribe`,
    },
    pages,
  };
}

export function buildPagePayload(
  pageId: string,
  content: PageContent,
  guide: StyleGuide | undefined,
  base: string
): PagePayload {
  const { rendered, hash } = renderAndHash(content, guide);
  const { html, assets } = buildPageFragment(rendered, base);
  return { id: pageId, content_hash: hash, html, assets };
}

export interface ConnectorDrift {
  /** The site has a published version newer than the connector's last pull. */
  behind: boolean;
  lastPublishedAt: string | null;
  lastPulledAt: string | null;
}

/**
 * Is the WordPress copy behind FreshPress? (Phase 3, Chunk 8.) True only when the
 * site has published content NEWER than the connector's last pull. Not "behind"
 * before the first publish (nothing to be behind of) or before the first pull
 * (no WP copy pulled yet, and no "last pulled" time to show).
 */
export function computeConnectorDrift(
  lastPublishedAt: string | null | undefined,
  lastPulledAt: string | null | undefined
): ConnectorDrift {
  const behind =
    !!lastPublishedAt &&
    !!lastPulledAt &&
    new Date(lastPublishedAt).getTime() > new Date(lastPulledAt).getTime();
  return { behind, lastPublishedAt: lastPublishedAt ?? null, lastPulledAt: lastPulledAt ?? null };
}

/** Latest publish time for a site, from the publish records (metadata only — no page content loaded). */
async function latestPublishedAt(siteId: string): Promise<string | null> {
  const publishes = await listPublishes(siteId);
  let latest: string | null = null;
  for (const p of publishes) {
    if (!latest || new Date(p.createdAt).getTime() > new Date(latest).getTime()) latest = p.createdAt;
  }
  return latest;
}

/** A sync report body this big is never legitimate (it's a counts summary) — reject before storing. */
const SYNC_REPORT_MAX_BYTES = 16 * 1024;

/**
 * Rate-limit key for the connector API: the sha256 of the bearer token, so each WP
 * site gets its own budget and one can't exhaust another's. Falls back to the client
 * IP when no bearer is present (the request will 401 anyway). Runs before auth, so it
 * reads the header directly rather than req.auth.
 */
export function connectorRateLimitKey(req: Pick<Request, 'headers' | 'ip'>): string {
  const raw = req.headers.authorization;
  const auth = typeof raw === 'string' ? raw : '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token ? `t:${createHash('sha256').update(token).digest('hex')}` : `ip:${req.ip ?? 'anon'}`;
}

/**
 * Per-token limiter for `/api/connect/v1/*` (Phase 3, Chunk 9). GENEROUS — the
 * connector is a low-frequency pull: a sync is one manifest + the changed pages +
 * one report, so this only trips on a runaway loop or abuse. Exported factory so a
 * unit test can drive it with a tiny `max`.
 */
export function makeConnectorRateLimiter(overrides: Parameters<typeof rateLimit>[0] = {}) {
  return rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: connectorRateLimitKey,
    validate: false, // custom key is a token hash, not an IP — skip the IPv6 key validation
    message: { error: 'Too many connector requests — the connector is a low-frequency pull API. Slow down and retry.' },
    ...overrides,
  });
}

export const connectorRateLimiter = makeConnectorRateLimiter();

const router = Router();

// ---- Admin: issue / revoke / status (dashboard) ----

/**
 * Issue (or rotate) the site's connector token. Plaintext is returned ONCE.
 * Tier-gated: only issuing is paid — revoke, status, and the token-authenticated
 * WP-plugin routes stay ungated so an existing connection keeps working (and can
 * be cleaned up) after a downgrade; the workspace just can't mint new tokens.
 */
router.post('/sites/:siteId/connect/token', requireOwner, requireFeature('wordpressConnector'), async (req, res) => {
  try {
    const store = await getConnectorTokenStore();
    const { token } = await store.issue(routeParam(req.params.siteId));
    res.status(201).json({ token });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Token issue failed' });
  }
});

/** Revoke the site's connector token — sync breaks immediately (401 thereafter). */
router.delete('/sites/:siteId/connect/token', requireOwner, async (req, res) => {
  try {
    const store = await getConnectorTokenStore();
    await store.revoke(routeParam(req.params.siteId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Token revoke failed' });
  }
});

/**
 * Masked status for the dashboard — never returns the token itself. Additively
 * carries the latest WordPress-reported sync (`lastReport`, Chunk 6) and a drift
 * indicator (`drift`, Chunk 8) so the editor card needs no extra requests.
 */
router.get('/sites/:siteId/connect/token', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const status = await (await getConnectorTokenStore()).getStatus(siteId);
    const lastReport = await (await getConnectorSyncReportStore()).get(siteId);
    const publishedAt = status.connected ? await latestPublishedAt(siteId) : null;
    const drift = computeConnectorDrift(publishedAt, status.lastUsedAt);
    res.json({ ...status, lastReport, drift });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Token status failed' });
  }
});

// ---- Connector: read-only manifest + page (siteId comes from the token) ----

// Per-token rate limit on the whole connector surface (before auth resolution).
router.use('/connect/v1', connectorRateLimiter);

router.get('/connect/v1/manifest', requireConnectorToken, async (req, res) => {
  try {
    const siteId = req.auth?.siteId;
    if (!siteId) {
      res.status(401).json({ error: 'Connector token required' });
      return;
    }
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const snapshot = await getPublishedSnapshot(siteId);
    const guide = (await (await getStyleGuideStore()).get(siteId)) ?? undefined;
    res.json(buildManifest(site, snapshot, guide, appBase()));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Manifest failed' });
  }
});

router.get('/connect/v1/pages/:pageId', requireConnectorToken, async (req, res) => {
  try {
    const siteId = req.auth?.siteId;
    if (!siteId) {
      res.status(401).json({ error: 'Connector token required' });
      return;
    }
    const pageId = routeParam(req.params.pageId);
    const snapshot = await getPublishedSnapshot(siteId);
    const content = snapshot?.pages[pageId];
    if (!content) {
      res.status(404).json({ error: 'Page not published' });
      return;
    }
    const guide = (await (await getStyleGuideStore()).get(siteId)) ?? undefined;
    res.json(buildPagePayload(pageId, content, guide, appBase()));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Page fetch failed' });
  }
});

/**
 * Sync-back status channel (Chunk 6). The plugin POSTs a trimmed sync summary after
 * each non-dry sync; we keep the latest per site for the editor card. Malformed or
 * oversized bodies are rejected with 400 WITHOUT touching storage.
 */
router.post('/connect/v1/sync-report', requireConnectorToken, async (req, res) => {
  try {
    const siteId = req.auth?.siteId;
    if (!siteId) {
      res.status(401).json({ error: 'Connector token required' });
      return;
    }
    if (JSON.stringify(req.body ?? '').length > SYNC_REPORT_MAX_BYTES) {
      res.status(400).json({ error: 'Sync report too large' });
      return;
    }
    const parsed = ConnectorSyncReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid sync report' });
      return;
    }
    await (await getConnectorSyncReportStore()).save(siteId, parsed.data, new Date().toISOString());
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync report failed' });
  }
});

export default router;
