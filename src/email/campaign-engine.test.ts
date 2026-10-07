import { describe, it, expect } from 'vitest';
import {
  addDays,
  advanceEnrollment,
  appendCampaignFooter,
  campaignComplianceHeaders,
  createEnrollment,
  enrollmentId,
  isCampaignLive,
  isWelcomeCampaign,
  normalizeDelayDays,
  pagePathSlug,
  signupMatchesPillar,
  stopEnrollment,
} from './campaign-engine.js';
import type { CampaignStep } from '../content/campaign-types.js';

const NOW = '2026-09-22T12:00:00.000Z';

function step(order: number, delayDays: number): CampaignStep {
  return {
    id: `step${order}`,
    campaignId: 'c1',
    siteId: 'site1',
    order,
    subject: `Email ${order + 1}`,
    previewText: '',
    bodyHtml: '<p>hi</p>',
    delayDays,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const STEPS = [step(0, 0), step(1, 2), step(2, 3)];

describe('createEnrollment', () => {
  it('starts at step 0 with the first step due after its delay (0 = immediately)', () => {
    const e = createEnrollment({ id: 'c1', siteId: 'site1' }, STEPS, { id: 'sub1', email: 'a@b.com' }, NOW);
    expect(e.status).toBe('active');
    expect(e.nextStepOrder).toBe(0);
    expect(e.nextSendAt).toBe(NOW);
    expect(e.email).toBe('a@b.com');
  });

  it('uses a deterministic id per (site, campaign, subscriber) so a racing second enroll collides', () => {
    const a = createEnrollment({ id: 'c1', siteId: 'site1' }, STEPS, { id: 'sub1', email: 'a@b.com' }, NOW);
    const b = createEnrollment({ id: 'c1', siteId: 'site1' }, STEPS, { id: 'sub1', email: 'a@b.com' }, NOW);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(enrollmentId('site1', 'c1', 'sub1'));
    expect(a.id).toMatch(/^[0-9a-f]{24}$/); // filename-safe
    expect(enrollmentId('site1', 'c1', 'sub2')).not.toBe(a.id);
    expect(enrollmentId('site1', 'c2', 'sub1')).not.toBe(a.id);
  });
});

describe('normalizeDelayDays / addDays', () => {
  it('coerces to a whole, non-negative day count', () => {
    expect(normalizeDelayDays(3)).toBe(3);
    expect(normalizeDelayDays('4')).toBe(4);
    expect(normalizeDelayDays('2 days')).toBe(2);
    expect(normalizeDelayDays(2.7)).toBe(2);
    expect(normalizeDelayDays(0)).toBe(0);
    expect(normalizeDelayDays(1e12)).toBe(365);
  });

  it('falls back for anything unusable', () => {
    for (const bad of ['soon', '', null, undefined, NaN, Infinity, -1, {}, [2]]) {
      expect(normalizeDelayDays(bad, 5)).toBe(5);
    }
    expect(normalizeDelayDays('soon')).toBe(0);
  });

  it('addDays never throws on a bad delay (a throw here would leave an enrollment stuck forever)', () => {
    expect(addDays(NOW, 'abc' as unknown as number)).toBe(NOW);
    expect(addDays(NOW, 1e300)).toBe(addDays(NOW, 365));
  });

  it('advanceEnrollment still advances when a stored step has a non-numeric delay', () => {
    const steps = [step(0, 0), { ...step(1, 0), delayDays: 'two' as unknown as number }];
    const e = createEnrollment({ id: 'c1', siteId: 'site1' }, steps, { id: 'sub1', email: 'a@b.com' }, NOW);
    const advanced = advanceEnrollment(e, steps, NOW);
    expect(advanced.nextStepOrder).toBe(1);
    expect(advanced.nextSendAt).toBe(NOW);
  });
});

describe('isCampaignLive', () => {
  it('is true only for natively activated, active campaigns', () => {
    expect(isCampaignLive({ status: 'active', engine: 'native' })).toBe(true);
    expect(isCampaignLive({ status: 'paused', engine: 'native' })).toBe(false);
    expect(isCampaignLive({ status: 'draft' })).toBe(false);
    // Left 'active' by the pre-native Resend Automations stub — behaves as paused.
    expect(isCampaignLive({ status: 'active' })).toBe(false);
  });
});

describe('isWelcomeCampaign', () => {
  it('is true only for the welcome audience — records without one are pillar campaigns', () => {
    expect(isWelcomeCampaign({ audience: 'welcome' })).toBe(true);
    expect(isWelcomeCampaign({ audience: 'pillar' })).toBe(false);
    expect(isWelcomeCampaign({})).toBe(false);
  });
});

describe('signup page → pillar matching', () => {
  const pillar = { slug: 'water-heaters' };
  const posts = [{ slug: 'tankless-vs-tank' }, { slug: 'Draft-Post' }];

  it('extracts the slug from static and WordPress page paths', () => {
    expect(pagePathSlug('/blog/tankless-vs-tank.html')).toBe('tankless-vs-tank');
    expect(pagePathSlug('/blog/x.htm')).toBe('x');
    expect(pagePathSlug('/x/')).toBe('x');
    expect(pagePathSlug('/blog/x/?utm=1')).toBe('x');
    expect(pagePathSlug('/blog/x.html#signup')).toBe('x');
    expect(pagePathSlug('/Blog/X.HTML')).toBe('x');
    expect(pagePathSlug('/')).toBeNull();
    expect(pagePathSlug('')).toBeNull();
    expect(pagePathSlug(undefined)).toBeNull();
  });

  it("matches the pillar's own page and any of its posts", () => {
    expect(signupMatchesPillar('/blog/water-heaters.html', pillar, posts)).toBe(true);
    expect(signupMatchesPillar('/water-heaters/', pillar, posts)).toBe(true);
    expect(signupMatchesPillar('/blog/tankless-vs-tank/?utm=1', pillar, posts)).toBe(true);
    expect(signupMatchesPillar('/blog/TANKLESS-VS-TANK.html', pillar, posts)).toBe(true);
    expect(signupMatchesPillar('/draft-post/', pillar, posts)).toBe(true);
  });

  it('does not match other pages, the site root, or a missing path', () => {
    expect(signupMatchesPillar('/blog/furnaces.html', pillar, posts)).toBe(false);
    expect(signupMatchesPillar('/contact', pillar, posts)).toBe(false);
    expect(signupMatchesPillar('/', pillar, posts)).toBe(false);
    expect(signupMatchesPillar(undefined, pillar, posts)).toBe(false);
    // Segment match only — a pillar slug elsewhere in the path doesn't count.
    expect(signupMatchesPillar('/water-heaters/other-page/', pillar, posts)).toBe(false);
  });
});

describe('advanceEnrollment', () => {
  it('moves to the next step with its delay applied from now', () => {
    const e = createEnrollment({ id: 'c1', siteId: 'site1' }, STEPS, { id: 'sub1', email: 'a@b.com' }, NOW);
    const advanced = advanceEnrollment(e, STEPS, NOW);
    expect(advanced.nextStepOrder).toBe(1);
    expect(advanced.nextSendAt).toBe(addDays(NOW, 2));
    expect(advanced.lastSentAt).toBe(NOW);
    expect(advanced.status).toBe('active');
  });

  it('completes after the last step and removes nextSendAt entirely', () => {
    let e = createEnrollment({ id: 'c1', siteId: 'site1' }, STEPS, { id: 'sub1', email: 'a@b.com' }, NOW);
    e = advanceEnrollment(e, STEPS, NOW); // sent step 0
    e = advanceEnrollment(e, STEPS, NOW); // sent step 1
    const done = advanceEnrollment(e, STEPS, NOW); // sent step 2 (last)
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBe(NOW);
    expect('nextSendAt' in done).toBe(false);
  });
});

describe('stopEnrollment', () => {
  it('records the reason and removes nextSendAt so it can never look due', () => {
    const e = createEnrollment({ id: 'c1', siteId: 'site1' }, STEPS, { id: 'sub1', email: 'a@b.com' }, NOW);
    const stopped = stopEnrollment(e, 'unsubscribed', NOW);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stopReason).toBe('unsubscribed');
    expect('nextSendAt' in stopped).toBe(false);
  });
});

describe('compliance', () => {
  it('emits RFC 8058 one-click unsubscribe headers', () => {
    expect(campaignComplianceHeaders('https://x.com/u?token=t')).toEqual({
      'List-Unsubscribe': '<https://x.com/u?token=t>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('appends a visible unsubscribe footer with the link', () => {
    const html = appendCampaignFooter('<p>body</p>', 'Acme', 'https://x.com/u?token=t');
    expect(html).toContain('<p>body</p>');
    expect(html).toContain('href="https://x.com/u?token=t"');
    expect(html).toContain('Unsubscribe');
  });
});
