import { describe, it, expect } from 'vitest';
import { isBlockedInDemo, isAiLimitedInDemo } from './middleware.js';

/**
 * The demo blocklist matrix. Demo visitors share ONE workspace (nightly
 * reset), so destructive ops and the arbitrary-HTML ingest are blocked — but
 * the create-site wizard must complete end-to-end, so apply-generated stays
 * open (its pages are script-checked by validateGeneratedPage instead).
 */
describe('isBlockedInDemo', () => {
  it.each([
    ['POST', '/api/sites/abc/publish'],
    ['DELETE', '/api/sites/abc'],
    ['POST', '/api/wordpress-import'],
    ['POST', '/api/sites/abc/pages/ingest'],
    ['PUT', '/api/admin/integrations'],
    ['PATCH', '/api/admin/integrations'],
    ['POST', '/api/auth/bootstrap'],
  ])('blocks %s %s', (method, path) => {
    expect(isBlockedInDemo(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/api/sites/abc'],
    ['POST', '/api/sites'],
    ['POST', '/api/sites/abc/pages/apply-generated'],
    ['POST', '/api/sites/abc/generate'],
    ['POST', '/api/sites/abc/design/generate'],
    ['PATCH', '/api/sites/abc/design'],
    ['GET', '/api/sites/abc/pages/xyz/preview'],
  ])('allows %s %s', (method, path) => {
    expect(isBlockedInDemo(method, path)).toBe(false);
  });
});

/**
 * The AI-budget matrix. The limiter is mounted at the /api/sites PREFIX, so
 * this decision is what keeps ordinary dashboard reads from burning the
 * 20/hr AI budget — before it existed, ~20 clicks emptied the demo ("No
 * client sites yet") for that visitor's whole hour.
 */
describe('isAiLimitedInDemo', () => {
  it.each([
    ['POST', '/api/sites/abc/pages/xyz/chat'],
    ['POST', '/api/sites/abc/pages/xyz/chat/preview'],
    ['POST', '/api/sites/abc/generate'],
    ['POST', '/api/sites/abc/design/generate'],
    ['POST', '/api/sites/abc/design/chat'],
    ['POST', '/api/sites/abc/design/apply'],
    ['POST', '/api/sites/abc/design/import'],
    ['POST', '/api/sites/abc/design/extract-brand'],
    ['GET', '/api/sites/abc/design/preview/stripe'],
    ['POST', '/api/sites/abc/blog/posts/p1/social/generate'],
    ['POST', '/api/sites/abc/social/drafts/d1/humanize'],
    ['POST', '/api/sites/abc/social/drafts/d1/detect-ai'],
    ['POST', '/api/sites/abc/social/drafts/d1/regenerate-cards'],
    ['POST', '/api/sites/abc/media/generate-image'],
    ['POST', '/api/sites/abc/brand-research/generate/research'],
    ['POST', '/api/sites/abc/inbox/threads/t1/auto-draft'],
    ['POST', '/api/admin/humanizer/humanize'],
  ])('limits %s %s', (method, path) => {
    expect(isAiLimitedInDemo(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/api/sites'],
    ['GET', '/api/sites/abc'],
    ['GET', '/api/sites/abc/design'],
    ['GET', '/api/sites/abc/pages/xyz/preview'],
    ['GET', '/api/sites/abc/inbox/folders'],
    ['GET', '/api/sites/abc/inbox/threads'],
    ['GET', '/api/sites/abc/campaigns'],
    ['GET', '/api/sites/abc/submissions'],
    ['POST', '/api/sites'],
    ['POST', '/api/sites/abc/pages/apply-generated'],
    ['PATCH', '/api/sites/abc/pages/xyz'],
    ['POST', '/api/sites/abc/snapshot'],
  ])('skips %s %s', (method, path) => {
    expect(isAiLimitedInDemo(method, path)).toBe(false);
  });
});
