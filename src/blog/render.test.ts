import { describe, it, expect } from 'vitest';
import { renderBlogPostHtml, renderBlogBundle } from './render.js';

const pillar = {
  id: 'p1',
  siteId: 's1',
  keyword: 'email marketing',
  slug: 'email-marketing-guide',
  title: 'Email Marketing Guide',
  order: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const post = {
  id: 'post1',
  siteId: 's1',
  pillarId: 'p1',
  kind: 'pillar' as const,
  title: 'Email Marketing Guide',
  slug: 'email-marketing-guide',
  keyword: 'email marketing',
  bodyHtml: '<p>Hello world content here.</p>',
  status: 'published' as const,
  order: 0,
  publishedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('blog render', () => {
  it('renders post with JSON-LD', () => {
    const html = renderBlogPostHtml(post, { siteUrl: 'https://example.com', pillar });
    expect(html).toContain('application/ld+json');
    expect(html).toContain('Email Marketing Guide');
  });

  it('renders blog bundle paths', () => {
    const files = renderBlogBundle([{ pillar, posts: [post] }], { siteUrl: 'https://example.com' });
    expect(files['blog/index.html']).toContain('Blog');
    expect(files['blog/email-marketing-guide.html']).toBeDefined();
  });
});
