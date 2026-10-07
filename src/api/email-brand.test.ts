import { describe, it, expect } from 'vitest';
import { resolveEmailLogoUrl } from './email-brand.js';

/**
 * The header-logo <img src> for branded email. The StyleGuide logo is usually an SVG
 * (Brand Studio uploads assets/logo.svg), which Gmail and Outlook desktop don't render —
 * so email uses the raster rendition when there is one and the site name otherwise.
 */
describe('resolveEmailLogoUrl', () => {
  const APP = 'https://app.example.com';

  it('returns undefined when the guide has no logo', () => {
    expect(resolveEmailLogoUrl(undefined, APP)).toBeUndefined();
  });

  it('never returns an SVG — no raster rendition means no <img> (site-name fallback)', () => {
    expect(resolveEmailLogoUrl({ url: '/media/site1/wp-content/uploads/logo.svg' }, APP)).toBeUndefined();
  });

  it('prefers the raster rendition over the SVG', () => {
    expect(
      resolveEmailLogoUrl(
        { url: '/media/site1/wp-content/uploads/logo.svg', rasterUrl: '/media/site1/wp-content/uploads/logo.png' },
        APP
      )
    ).toBe('https://app.example.com/media/site1/wp-content/uploads/logo.png');
  });

  it('uses a raster url directly when that is the only logo', () => {
    expect(resolveEmailLogoUrl({ url: '/media/site1/wp-content/uploads/logo.png' }, APP)).toBe(
      'https://app.example.com/media/site1/wp-content/uploads/logo.png'
    );
  });

  it('strips a trailing slash from APP_URL (no //media/... URLs)', () => {
    expect(resolveEmailLogoUrl({ url: '/media/site1/wp-content/uploads/logo.png' }, 'https://app.example.com/')).toBe(
      'https://app.example.com/media/site1/wp-content/uploads/logo.png'
    );
  });

  it('passes absolute http(s) urls through unchanged', () => {
    expect(resolveEmailLogoUrl({ url: 'https://cdn.example.com/logo.png' }, APP)).toBe('https://cdn.example.com/logo.png');
  });
});
