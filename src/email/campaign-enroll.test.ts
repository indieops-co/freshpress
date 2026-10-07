import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CampaignStore } from '../storage/campaigns.js';
import { BlogSiloStore } from '../storage/blog-silo.js';
import { createEnrollment } from './campaign-engine.js';
import { enrollExistingSubscribers, enrollInMatchingCampaigns, type EnrollDeps } from './campaign-enroll.js';
import type { CampaignStep, EmailCampaign } from '../content/campaign-types.js';
import type { Subscriber } from '../storage/types.js';

const TEST_DATA = join(process.cwd(), 'data-test-campaign-enroll');
const SITE = 'site1';
const NOW = '2026-09-22T12:00:00.000Z';

let campaigns: CampaignStore;
let blog: BlogSiloStore;
let campaign: EmailCampaign;
let steps: CampaignStep[];

function subscriber(id: string, pagePath?: string, status: Subscriber['status'] = 'confirmed'): Subscriber {
  return {
    id,
    siteId: SITE,
    email: `${id}@example.com`,
    status,
    unsubscribeToken: `unsub-${id}`,
    ...(pagePath ? { pagePath } : {}),
    createdAt: NOW,
    confirmedAt: NOW,
  };
}

beforeEach(async () => {
  campaigns = new CampaignStore({ dataDir: TEST_DATA });
  blog = new BlogSiloStore({ dataDir: TEST_DATA });
  const pillar = await blog.createPillar(SITE, { keyword: 'water heaters', slug: 'water-heaters', title: 'Water Heaters' });
  await blog.createPost(SITE, {
    pillarId: pillar.id,
    kind: 'supportive',
    title: 'Tankless vs tank',
    slug: 'tankless-vs-tank',
    keyword: 'tankless',
  });
  campaign = await campaigns.saveCampaign({
    id: 'c1',
    siteId: SITE,
    pillarId: pillar.id,
    keyword: 'water heaters',
    name: 'Nurture',
    status: 'active',
    engine: 'native',
    createdAt: NOW,
    updatedAt: NOW,
  });
  steps = [
    {
      id: 's0',
      campaignId: 'c1',
      siteId: SITE,
      order: 0,
      subject: 'Hi',
      previewText: '',
      bodyHtml: '<p>hi</p>',
      delayDays: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  await campaigns.saveSteps(SITE, 'c1', steps);
});

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

/** The site's catch-all campaign, live unless overridden, with one step. */
async function saveWelcome(overrides: Partial<EmailCampaign> = {}): Promise<EmailCampaign> {
  const welcome = await campaigns.saveCampaign({
    id: 'w1',
    siteId: SITE,
    audience: 'welcome',
    name: 'Welcome',
    status: 'active',
    engine: 'native',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
  await campaigns.saveSteps(SITE, 'w1', [{ ...steps[0], id: 'ws0', campaignId: 'w1' }]);
  return welcome;
}

async function enrolledIn(campaignId: string): Promise<string[]> {
  return (await campaigns.listEnrollments(SITE, campaignId)).map((e) => e.subscriberId).sort();
}

/** Holds every existence check until all `racers` have made one — forces the check-then-insert race. */
function racingCampaigns(racers: number): EnrollDeps['campaigns'] {
  let checked = 0;
  let release!: () => void;
  const allChecked = new Promise<void>((resolve) => (release = resolve));
  return {
    listCampaigns: (siteId) => campaigns.listCampaigns(siteId),
    listSteps: (siteId, campaignId) => campaigns.listSteps(siteId, campaignId),
    createEnrollmentIfAbsent: (e) => campaigns.createEnrollmentIfAbsent(e),
    getEnrollment: async (siteId, campaignId, subscriberId) => {
      const found = await campaigns.getEnrollment(siteId, campaignId, subscriberId);
      if (++checked === racers) release();
      await allChecked;
      return found;
    },
  };
}

describe('enrollInMatchingCampaigns', () => {
  it("enrolls a subscriber who signed up on one of the pillar's posts", async () => {
    await enrollInMatchingCampaigns(SITE, subscriber('sub1', '/blog/tankless-vs-tank.html'), { campaigns, blog });
    const enrolled = await campaigns.listEnrollments(SITE, 'c1');
    expect(enrolled.map((e) => e.subscriberId)).toEqual(['sub1']);
  });

  it('does not enroll a subscriber from another page, or with no page path', async () => {
    await enrollInMatchingCampaigns(SITE, subscriber('sub1', '/contact'), { campaigns, blog });
    await enrollInMatchingCampaigns(SITE, subscriber('sub2'), { campaigns, blog });
    expect(await campaigns.listEnrollments(SITE)).toHaveLength(0);
  });

  it('does not enroll into a legacy Resend-era "active" campaign until it is natively activated', async () => {
    const { engine: _engine, ...legacy } = campaign;
    await campaigns.saveCampaign({ ...legacy, resendAutomationId: 'pending-c1' });
    await enrollInMatchingCampaigns(SITE, subscriber('sub1', '/water-heaters/'), { campaigns, blog });
    expect(await campaigns.listEnrollments(SITE)).toHaveLength(0);
  });

  it('two concurrent enroll calls for the same subscriber produce exactly one enrollment', async () => {
    const sub = subscriber('sub1', '/water-heaters/');
    const racing = racingCampaigns(3); // all three see "not enrolled" before any of them writes
    await Promise.all([
      enrollInMatchingCampaigns(SITE, sub, { campaigns: racing, blog }),
      enrollInMatchingCampaigns(SITE, sub, { campaigns: racing, blog }),
      enrollExistingSubscribers(campaign, steps, [sub], { campaigns: racing, blog }),
    ]);
    expect(await campaigns.listEnrollments(SITE)).toHaveLength(1);
  });

  it('does not re-enroll a subscriber who has a legacy random-id enrollment', async () => {
    const sub = subscriber('sub1', '/water-heaters/');
    await campaigns.saveEnrollment({ ...createEnrollment(campaign, steps, sub, NOW), id: 'legacyRandom' });
    await enrollInMatchingCampaigns(SITE, sub, { campaigns, blog });
    expect((await campaigns.listEnrollments(SITE)).map((e) => e.id)).toEqual(['legacyRandom']);
  });
});

describe('enrollInMatchingCampaigns — welcome catch-all', () => {
  it('enrolls homepage, landing-page, contact-page and no-path signups in the welcome campaign', async () => {
    await saveWelcome();
    for (const [id, path] of [['home', '/'], ['landing', '/spring-sale.html'], ['contact', '/contact/'], ['no-path', undefined]]) {
      await enrollInMatchingCampaigns(SITE, subscriber(id as string, path), { campaigns, blog });
    }
    expect(await enrolledIn('w1')).toEqual(['contact', 'home', 'landing', 'no-path']);
    expect(await enrolledIn('c1')).toEqual([]);
  });

  it('a signup that matches a live pillar campaign gets that campaign only, not the welcome', async () => {
    await saveWelcome();
    await enrollInMatchingCampaigns(SITE, subscriber('sub1', '/blog/tankless-vs-tank.html'), { campaigns, blog });
    expect(await enrolledIn('c1')).toEqual(['sub1']);
    expect(await enrolledIn('w1')).toEqual([]);
  });

  it("still skips the welcome for a pillar signup who's already in (or finished) that pillar's campaign", async () => {
    await saveWelcome();
    const sub = subscriber('sub1', '/water-heaters/');
    await enrollInMatchingCampaigns(SITE, sub, { campaigns, blog });
    await enrollInMatchingCampaigns(SITE, sub, { campaigns, blog });
    expect(await campaigns.listEnrollments(SITE)).toHaveLength(1);
    expect(await enrolledIn('c1')).toEqual(['sub1']);
  });

  it('a blog signup whose pillar has no live campaign gets the welcome', async () => {
    await saveWelcome();
    const furnaces = await blog.createPillar(SITE, { keyword: 'furnaces', slug: 'furnaces', title: 'Furnaces' });
    await blog.createPost(SITE, { pillarId: furnaces.id, kind: 'supportive', title: 'Filters', slug: 'furnace-filters', keyword: 'filters' });
    await enrollInMatchingCampaigns(SITE, subscriber('no-campaign', '/blog/furnace-filters.html'), { campaigns, blog });

    await campaigns.saveCampaign({ ...campaign, status: 'paused' });
    await enrollInMatchingCampaigns(SITE, subscriber('paused-pillar', '/blog/water-heaters.html'), { campaigns, blog });

    expect(await enrolledIn('w1')).toEqual(['no-campaign', 'paused-pillar']);
    expect(await enrolledIn('c1')).toEqual([]);
  });

  it('enrolls nobody when there is no welcome campaign, or it is not live', async () => {
    await enrollInMatchingCampaigns(SITE, subscriber('none', '/'), { campaigns, blog });
    for (const [id, overrides] of [
      ['draft', { status: 'draft' }],
      ['paused', { status: 'paused' }],
      ['legacy', { engine: undefined }], // left 'active' by the Resend-era stub
    ] as Array<[string, Partial<EmailCampaign>]>) {
      await saveWelcome(overrides);
      await enrollInMatchingCampaigns(SITE, subscriber(id, '/'), { campaigns, blog });
    }
    expect(await campaigns.listEnrollments(SITE)).toHaveLength(0);
  });

  it('enrolls a repeat confirm in the welcome only once', async () => {
    await saveWelcome();
    const sub = subscriber('sub1', '/');
    await enrollInMatchingCampaigns(SITE, sub, { campaigns, blog });
    await enrollInMatchingCampaigns(SITE, sub, { campaigns, blog });
    expect(await enrolledIn('w1')).toEqual(['sub1']);
  });
});

describe('enrollExistingSubscribers', () => {
  it("backfills only confirmed subscribers who signed up on this pillar's pages", async () => {
    const count = await enrollExistingSubscribers(
      campaign,
      steps,
      [
        subscriber('match-pillar', '/blog/water-heaters.html'),
        subscriber('match-post', '/tankless-vs-tank/'),
        subscriber('pending', '/water-heaters/', 'pending'),
        subscriber('elsewhere', '/about/'),
        subscriber('no-path'),
      ],
      { campaigns, blog }
    );
    expect(count).toBe(2);
    const ids = (await campaigns.listEnrollments(SITE)).map((e) => e.subscriberId).sort();
    expect(ids).toEqual(['match-pillar', 'match-post']);
  });
});

describe('enrollExistingSubscribers — welcome campaign', () => {
  it('backfills confirmed subscribers that no live pillar campaign matches, once', async () => {
    const welcome = await saveWelcome();
    const welcomeSteps = await campaigns.listSteps(SITE, 'w1');
    const subs = [
      subscriber('home', '/'),
      subscriber('no-path'),
      subscriber('other-blog', '/blog/furnaces.html'),
      subscriber('pillar-post', '/blog/tankless-vs-tank.html'),
      subscriber('pending', '/', 'pending'),
      subscriber('unsubscribed', '/', 'unsubscribed'),
    ];
    expect(await enrollExistingSubscribers(welcome, welcomeSteps, subs, { campaigns, blog })).toBe(3);
    expect(await enrolledIn('w1')).toEqual(['home', 'no-path', 'other-blog']);
    expect(await enrollExistingSubscribers(welcome, welcomeSteps, subs, { campaigns, blog })).toBe(0);
  });

  it("includes a pillar's signups while that pillar's campaign isn't live", async () => {
    await campaigns.saveCampaign({ ...campaign, status: 'paused' });
    const welcome = await saveWelcome();
    const count = await enrollExistingSubscribers(
      welcome,
      await campaigns.listSteps(SITE, 'w1'),
      [subscriber('pillar-post', '/blog/tankless-vs-tank.html')],
      { campaigns, blog }
    );
    expect(count).toBe(1);
  });
});

describe('CampaignStore enrollments (filesystem)', () => {
  it('createEnrollmentIfAbsent writes once and reports a duplicate', async () => {
    const e = createEnrollment(campaign, steps, subscriber('sub1'), NOW);
    expect(await campaigns.createEnrollmentIfAbsent(e)).toBe(true);
    expect(await campaigns.createEnrollmentIfAbsent({ ...e, nextStepOrder: 5 })).toBe(false);
    expect((await campaigns.getEnrollmentById(SITE, e.id))?.nextStepOrder).toBe(0);
  });

  it('a half-written enrollment file skips only itself', async () => {
    const e = createEnrollment(campaign, steps, subscriber('sub1'), NOW);
    await campaigns.createEnrollmentIfAbsent(e);
    const dir = join(TEST_DATA, 'campaigns', SITE, 'enrollments');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'torn.json'), '{"id":"torn","siteId":', 'utf-8');
    expect((await campaigns.listEnrollments(SITE)).map((x) => x.id)).toEqual([e.id]);
  });
});
