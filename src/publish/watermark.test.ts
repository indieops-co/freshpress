import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { injectWatermark, watermarkHtml } from './watermark.js';
import { savePublishBundle } from './index.js';
import type { SitePage } from '../storage/types.js';

const TEST_SITE = 'site-watermark-test';

afterEach(async () => {
  const root = process.env.DATA_DIR
    ? join(process.env.DATA_DIR, 'publishes', TEST_SITE)
    : join(process.cwd(), 'data', 'publishes', TEST_SITE);
  await rm(root, { recursive: true, force: true });
});

function makePage(path: string, template: string): SitePage {
  return {
    id: `pg_${path.replace(/\W/g, '') || 'home'}`,
    path,
    title: `Page ${path}`,
    content: { template, slots: {} },
  } as unknown as SitePage;
}

describe('injectWatermark', () => {
  it('inserts before the closing </body>', () => {
    const html = '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>';
    const out = injectWatermark(html);
    expect(out).toContain(watermarkHtml());
    expect(out.indexOf(watermarkHtml())).toBeLessThan(out.indexOf('</body>'));
  });

  it('appends when there is no </body>', () => {
    const out = injectWatermark('<h1>Fragment</h1>');
    expect(out.startsWith('<h1>Fragment</h1>')).toBe(true);
    expect(out).toContain('freshpress-watermark');
  });

  it('honors FRESHPRESS_WATERMARK_URL', () => {
    process.env.FRESHPRESS_WATERMARK_URL = 'https://example.org/brand';
    try {
      expect(watermarkHtml()).toContain('https://example.org/brand');
    } finally {
      delete process.env.FRESHPRESS_WATERMARK_URL;
    }
  });
});

describe('savePublishBundle watermarking', () => {
  it('stamps every .html file (static pages AND extraFiles) when watermark=true', async () => {
    const pages = [makePage('/', '<main>Home</main>')];
    const extra = { 'blog/post.html': '<html><body><article>Post</article></body></html>', 'feed.xml': '<rss/>' };
    const { files } = await savePublishBundle(TEST_SITE, pages, 'test', extra, undefined, true);
    expect(files['index.html']).toContain('freshpress-watermark');
    expect(files['blog/post.html']).toContain('freshpress-watermark');
    expect(files['feed.xml']).not.toContain('freshpress-watermark');
  });

  it('leaves output untouched when watermark=false (paid publish)', async () => {
    const pages = [makePage('/', '<main>Home</main>')];
    const { files } = await savePublishBundle(TEST_SITE, pages, 'test', {}, undefined, false);
    expect(files['index.html']).not.toContain('freshpress-watermark');
  });
});
