import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWxr,
  buildImportPreview,
  sortCategoriesParentFirst,
  getMetaValue,
} from './parse-wxr.js';
import { rewriteContentUrls, relativePathFromUrl } from './media-migrator.js';
import { runWordPressImport } from './run-import.js';
import { FileSystemStorage } from '../../storage/filesystem.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures/sample.wxr.xml');

describe('parseWxr', () => {
  const xml = readFileSync(fixturePath, 'utf-8');
  const parsed = parseWxr(xml);

  it('parses channel metadata', () => {
    expect(parsed.siteName).toBe('Sample Blog');
    expect(parsed.siteUrl).toBe('https://example.com');
    expect(parsed.wxrVersion).toBe('1.2');
  });

  it('parses authors', () => {
    expect(parsed.authors).toHaveLength(1);
    expect(parsed.authors[0].displayName).toBe('Jane Doe');
    expect(parsed.authors[0].email).toBe('jane@example.com');
  });

  it('parses nested categories', () => {
    expect(parsed.categories).toHaveLength(2);
    const sorted = sortCategoriesParentFirst(parsed.categories);
    expect(sorted[0].slug).toBe('news');
    expect(sorted[1].parentSlug).toBe('news');
  });

  it('parses tags', () => {
    expect(parsed.tags).toHaveLength(1);
    expect(parsed.tags[0].slug).toBe('featured');
  });

  it('parses attachments, posts, pages, and comments', () => {
    const attachment = parsed.items.find((i) => i.postType === 'attachment');
    expect(attachment?.attachmentUrl).toContain('hero.jpg');
    expect(getMetaValue(attachment!, '_wp_attached_file')).toBe('2024/01/hero.jpg');

    const post = parsed.items.find((i) => i.postType === 'post');
    expect(post?.comments).toHaveLength(2);
    expect(post?.comments[1].parentId).toBe(1);

    const page = parsed.items.find((i) => i.postType === 'page');
    expect(page?.slug).toBe('about');
  });

  it('builds import preview', () => {
    const preview = buildImportPreview(parsed);
    expect(preview.siteName).toBe('Sample Blog');
    expect(preview.counts.articles).toBe(2);
    expect(preview.counts.attachments).toBe(1);
    expect(preview.counts.comments).toBe(2);
    expect(preview.pages).toHaveLength(1);
  });
});

describe('rewriteContentUrls', () => {
  it('replaces known URLs in HTML', () => {
    const map = new Map([
      ['https://example.com/wp-content/uploads/2024/01/hero.jpg', '/media/abc/wp-content/uploads/2024/01/hero.jpg'],
    ]);
    const html = '<img src="https://example.com/wp-content/uploads/2024/01/hero.jpg" />';
    const out = rewriteContentUrls(html, map);
    expect(out).toContain('/media/abc/wp-content/uploads/2024/01/hero.jpg');
  });
});

describe('relativePathFromUrl', () => {
  it('extracts uploads relative path', () => {
    expect(
      relativePathFromUrl('https://example.com/wp-content/uploads/2024/01/hero.jpg')
    ).toBe('2024/01/hero.jpg');
  });
});

describe('runWordPressImport', () => {
  it('creates site with blog content from fixture', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cp-import-'));
    const storage = new FileSystemStorage(dataDir);
    const xml = readFileSync(fixturePath, 'utf-8');
    const parsed = parseWxr(xml);

    const { siteId, job } = await runWordPressImport({
      storage,
      parsed,
      sourceBaseUrl: 'https://example.com',
      sitePageSlugs: ['about'],
    });

    expect(job.status).toBe('completed');
    expect(job.stats.authors).toBe(1);
    expect(job.stats.categories).toBe(2);
    expect(job.stats.tags).toBe(1);
    expect(job.stats.articles).toBe(2);
    expect(job.stats.comments).toBe(2);
    expect(job.stats.sitePages).toBe(1);

    const site = await storage.getSite(siteId);
    expect(site?.meta.name).toBe('Sample Blog');

    const articles = await storage.listArticles(siteId);
    expect(articles).toHaveLength(2);

    const pages = await storage.listPages(siteId);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/about');

    await rm(dataDir, { recursive: true, force: true });
  });
});
