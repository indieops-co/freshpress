import { describe, it, expect, vi, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

const resolveAiKeys = vi.fn();

vi.mock('../integrations/resolve.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../integrations/resolve.js')>()),
  resolveAiKeys,
}));
vi.mock('../storage/filesystem.js', () => ({
  getStorage: async () => ({ getSite: async (id: string) => ({ meta: { id, name: 'Acme' }, pages: [] }) }),
}));
vi.mock('../auth/middleware.js', () => ({
  requireOwner: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSiteAccess: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { default: designRouter, parseDesignGenerateBody, parseDesignImportBody, isSiteMediaUploadPath } = await import(
  './design.js'
);
const { emptyExtractedBrand } = await import('../design/brand-extract.js');
const { default: express } = await import('express');

const intake = { brandName: 'Acme', personality: ['bold'] };

/**
 * The /design/generate body parser (Chunk 9): the wizard rides an accepted
 * ExtractedBrand along with the intake, and a malformed one must be rejected
 * loudly — an extraction the user accepted silently missing from the theme is
 * the failure mode this guards against. (The merge itself is
 * mergeExtractedBrand, tested in brand-extract.test.ts.)
 */
describe('parseDesignGenerateBody', () => {
  it('accepts a plain intake with no extracted brand', () => {
    const result = parseDesignGenerateBody({ ...intake, industry: 'saas' });
    expect(result).toEqual({ ok: true, intake: { ...intake, industry: 'saas' } });
  });

  it('requires brandName and a non-empty personality array', () => {
    expect(parseDesignGenerateBody({ personality: ['bold'] }).ok).toBe(false);
    expect(parseDesignGenerateBody({ brandName: '  ', personality: ['bold'] }).ok).toBe(false);
    expect(parseDesignGenerateBody({ brandName: 'Acme', personality: [] }).ok).toBe(false);
    expect(parseDesignGenerateBody({ brandName: 'Acme', personality: 'bold' }).ok).toBe(false);
    expect(parseDesignGenerateBody(undefined).ok).toBe(false);
  });

  it('passes a valid ExtractedBrand through, separated from the intake', () => {
    const extracted = emptyExtractedBrand('https://example.com');
    extracted.colors.primary = '#112233';
    const result = parseDesignGenerateBody({ ...intake, extracted });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extracted).toEqual(extracted);
    expect('extracted' in result.intake).toBe(false);
  });

  it('treats a null/absent extracted as not provided', () => {
    const result = parseDesignGenerateBody({ ...intake, extracted: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extracted).toBeUndefined();
  });

  it('rejects an extracted value that does not match the ExtractedBrand shape', () => {
    const result = parseDesignGenerateBody({ ...intake, extracted: { colors: 'red' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('ExtractedBrand');
  });
});

/** A missing AI key is the caller's setup to fix, so it's a 400 (as on POST /generate) — not a 500. */
describe('POST /sites/:siteId/design/generate', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', designRouter);
  const server = app.listen(0, '127.0.0.1');
  afterAll(() => server.close());

  it('answers 400 with the setup message when no AI provider is configured', async () => {
    resolveAiKeys.mockResolvedValue(null);
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/sites/site1/design/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intake),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'No AI provider configured. Add an Anthropic or OpenRouter key in Admin → Integrations.'
    );
  });
});

/**
 * The /design/import body (Brand Studio handoff). The logo pointer becomes an email
 * <img src>, so — per the StyleGuide schema — only this site's own media uploads (the
 * publicPath POST /sites/:siteId/media/upload returns) are accepted.
 */
describe('parseDesignImportBody', () => {
  const SITE = 'site1';
  const svg = '/media/site1/wp-content/uploads/AbC123xYz9.svg';
  const png = '/media/site1/wp-content/uploads/AbC123xYz9.png';
  const base = { rawDesignMd: '# Acme\n\n## 2. Color Palette', name: '  Acme  ' };

  it('accepts a DESIGN.md with no logo, trimming the name and defaulting the aesthetic', () => {
    expect(parseDesignImportBody(SITE, base)).toEqual({
      ok: true,
      rawDesignMd: base.rawDesignMd,
      name: 'Acme',
      aesthetic: 'Imported DESIGN.md',
    });
    expect(parseDesignImportBody(SITE, { ...base, logo: null }).ok).toBe(true);
  });

  it('requires rawDesignMd and name', () => {
    expect(parseDesignImportBody(SITE, { name: 'Acme' })).toEqual({ ok: false, error: 'rawDesignMd is required' });
    expect(parseDesignImportBody(SITE, { rawDesignMd: '# x', name: ' ' })).toEqual({ ok: false, error: 'name is required' });
    expect(parseDesignImportBody(SITE, undefined).ok).toBe(false);
  });

  it('accepts this site\'s media-upload logo (alt defaults to empty) plus an optional PNG rendition', () => {
    const svgOnly = parseDesignImportBody(SITE, { ...base, logo: { url: svg } });
    expect(svgOnly.ok && svgOnly.logo).toEqual({ url: svg, alt: '' });

    const both = parseDesignImportBody(SITE, { ...base, aesthetic: 'bold', logo: { url: svg, alt: 'Acme logo', rasterUrl: png } });
    expect(both).toMatchObject({ ok: true, aesthetic: 'bold', logo: { url: svg, alt: 'Acme logo', rasterUrl: png } });
  });

  it('requires logo.url when a logo is provided', () => {
    expect(parseDesignImportBody(SITE, { ...base, logo: {} })).toEqual({
      ok: false,
      error: 'logo.url is required when logo is provided',
    });
  });

  it.each([
    ['an external URL', 'https://evil.example.com/logo.svg'],
    ['another site\'s upload', '/media/site2/wp-content/uploads/logo.svg'],
    ['a path outside uploads', '/media/site1/social-images/card.png'],
    ['a .. climb', '/media/site1/wp-content/uploads/../../../etc/passwd'],
    ['a javascript: URI', 'javascript:alert(1)'],
    ['a data: URI', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['inline markup', '<svg onload="alert(1)"></svg>'],
    ['a query string', '/media/site1/wp-content/uploads/logo.png?x=<b>'],
  ])('rejects %s as logo.url', (_label, url) => {
    const result = parseDesignImportBody(SITE, { ...base, logo: { url } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('logo.url must be a media upload for this site');
  });

  it('rejects a rasterUrl that is not a PNG/JPEG/GIF media upload for this site', () => {
    const notMedia = parseDesignImportBody(SITE, { ...base, logo: { url: svg, rasterUrl: 'https://cdn.example.com/logo.png' } });
    expect(notMedia.ok).toBe(false);
    if (!notMedia.ok) expect(notMedia.error).toContain('logo.rasterUrl must be a media upload');

    const svgRaster = parseDesignImportBody(SITE, { ...base, logo: { url: svg, rasterUrl: svg } });
    expect(svgRaster.ok).toBe(false);
    if (!svgRaster.ok) expect(svgRaster.error).toContain('PNG, JPEG, or GIF');
  });
});

describe('isSiteMediaUploadPath', () => {
  it('accepts the upload publicPath shape, including nested WordPress-import paths', () => {
    expect(isSiteMediaUploadPath('site1', '/media/site1/wp-content/uploads/AbC123xYz9.png')).toBe(true);
    expect(isSiteMediaUploadPath('site1', '/media/site1/wp-content/uploads/2024/01/logo-dark.png')).toBe(true);
  });

  it('rejects the bare uploads dir and empty segments', () => {
    expect(isSiteMediaUploadPath('site1', '/media/site1/wp-content/uploads/')).toBe(false);
    expect(isSiteMediaUploadPath('site1', '/media/site1/wp-content/uploads//logo.png')).toBe(false);
    expect(isSiteMediaUploadPath('site1', '/media/site1/wp-content/uploads/./logo.png')).toBe(false);
  });
});
