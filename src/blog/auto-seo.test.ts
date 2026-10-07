import { describe, it, expect } from 'vitest';
import { applyAutoSeo } from './auto-seo.js';

const base = {
  id: '1',
  siteId: 's',
  pillarId: 'p',
  kind: 'pillar' as const,
  title: 'Email Marketing Guide for Small Business',
  slug: 'email-marketing',
  keyword: 'email marketing',
  bodyHtml: '<p>Email marketing helps you reach customers consistently.</p>',
  status: 'draft' as const,
  order: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('applyAutoSeo', () => {
  it('generates meta title and description', () => {
    const out = applyAutoSeo(base);
    expect(out.metaTitle).toContain('Email Marketing');
    expect(out.metaDescription!.length).toBeLessThanOrEqual(155);
  });
});
