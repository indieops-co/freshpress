import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import type { PlanTier } from '../auth/types.js';
import type { ContentSlot, PageContent } from '../content/types.js';
import type { Site } from '../storage/types.js';

const TEST_DATA = join(process.cwd(), 'data-test-campaigns-api');

const loadComposeInput = vi.fn();
const renderBrandedEmail = vi.fn();
const resolveAiKeys = vi.fn();
const callAiJson = vi.fn();
const getSite = vi.fn();
const getPublishedSnapshot = vi.fn();
const getBrandResearch = vi.fn();
const getPillar = vi.fn();
const listPosts = vi.fn();
let planTier: PlanTier | undefined = 'pro';

vi.mock('./email-brand.js', () => ({ loadComposeInput }));
vi.mock('../email/brand-render.js', () => ({ renderBrandedEmail }));
vi.mock('../integrations/resolve.js', () => ({ resolveAiKeys }));
vi.mock('../ai/call-json.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/call-json.js')>()),
  callAiJson,
}));
vi.mock('../storage/filesystem.js', () => ({ getStorage: async () => ({ getSite }) }));
vi.mock('../publish/service.js', () => ({ getPublishedSnapshot }));
vi.mock('../storage/blog-silo.js', () => ({ getBlogSiloStore: async () => ({ getPillar, listPosts }) }));
vi.mock('../storage/brand-research.js', () => ({ getBrandResearchStore: async () => ({ get: getBrandResearch }) }));
vi.mock('../storage/humanizer-config.js', () => ({
  getHumanizerConfigStore: async () => ({ getSiteConfig: async () => null }),
}));
vi.mock('../storage/campaigns.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/campaigns.js')>();
  const store = new actual.CampaignStore({ dataDir: TEST_DATA });
  return { ...actual, getCampaignStore: async () => store };
});
vi.mock('../auth/middleware.js', () => ({
  requireOwner: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { role: 'admin', planTier };
    next();
  },
  requireSiteAccess: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { default: campaignsRouter, renderStepEmailHtml, buildWelcomeSteps, welcomeFallbackSteps } = await import(
  './campaigns.js'
);
const { getCampaignStore } = await import('../storage/campaigns.js');
const { default: express } = await import('express');

function baseStep(overrides: Partial<Parameters<typeof renderStepEmailHtml>[1]> = {}) {
  return {
    id: 's1',
    campaignId: 'c1',
    siteId: 'site1',
    order: 0,
    subject: 'Hello',
    previewText: 'Preview',
    bodyHtml: '<p>raw body</p>',
    delayDays: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('renderStepEmailHtml', () => {
  it('passes through raw bodyHtml when formatId/templateId are unset', async () => {
    const step = baseStep();
    const html = await renderStepEmailHtml('site1', step, 'Acme');
    expect(html).toBe('<p>raw body</p>');
    expect(loadComposeInput).not.toHaveBeenCalled();
  });

  it('renders through the brand pipeline when both formatId and templateId are set', async () => {
    loadComposeInput.mockResolvedValueOnce({ format: {}, template: {} });
    renderBrandedEmail.mockResolvedValueOnce('<html>branded</html>');

    const step = baseStep({ formatId: 'fmt1', templateId: 'tpl1', includeBrand: false, includeSignature: false });
    const html = await renderStepEmailHtml('site1', step, 'Acme');

    expect(loadComposeInput).toHaveBeenCalledWith(
      'site1',
      expect.objectContaining({
        formatId: 'fmt1',
        templateId: 'tpl1',
        includeBrand: false,
        includeSignature: false,
      }),
      'Acme'
    );
    expect(html).toBe('<html>branded</html>');
  });

  it('falls back to raw bodyHtml if the format/template was deleted', async () => {
    loadComposeInput.mockRejectedValueOnce(new Error('Format not found'));
    const step = baseStep({ formatId: 'missing', templateId: 'missing' });
    const html = await renderStepEmailHtml('site1', step, 'Acme');
    expect(html).toBe('<p>raw body</p>');
  });
});

// ── Welcome campaign ──────────────────────────────────────────────────────────

const AI = { provider: 'anthropic' as const, apiKey: 'test-key', model: 'test-model' };

function textContent(...values: string[]): PageContent {
  const slots: Record<string, ContentSlot> = {};
  values.forEach((value, i) => {
    slots[`t${i}`] = { id: `t${i}`, type: 'text', value, tag: 'p', path: '' };
  });
  return { template: '', slots, slotOrder: Object.keys(slots) };
}

const SITE: Site = {
  meta: { id: 'site1', name: 'Acme Plumbing & Heating', domain: 'acme.example', createdAt: '', updatedAt: '' },
  pages: [
    { id: 'about', path: '/about', title: 'About', content: textContent(), updatedAt: '' },
    { id: 'home', path: '/', title: 'Home', content: textContent(), updatedAt: '' },
    { id: 'draft', path: '/new', title: 'Unpublished', content: textContent('Working-copy only'), updatedAt: '' },
  ],
};

beforeEach(() => {
  planTier = 'pro';
  resolveAiKeys.mockReset().mockResolvedValue(null);
  callAiJson.mockReset();
  getSite.mockReset().mockResolvedValue(SITE);
  getBrandResearch.mockReset().mockResolvedValue(null);
  getPillar.mockReset().mockImplementation(async (siteId: string, id: string) => ({
    id,
    siteId,
    keyword: `${id} keyword`,
    slug: id,
    title: `Pillar ${id}`,
    order: 0,
    createdAt: '',
    updatedAt: '',
  }));
  listPosts.mockReset().mockResolvedValue([]);
  getPublishedSnapshot.mockReset().mockResolvedValue({
    record: { id: 'pub1', siteId: 'site1', label: 'Publish', createdAt: '', pageCount: 2, bundlePath: '' },
    pages: {
      about: textContent('Family-owned since 1987.'),
      home: textContent('Emergency plumbing,', 'boilers and   heat pumps.'),
    },
  });
});

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

const app = express();
app.use(express.json());
app.use('/api', campaignsRouter);
const server = app.listen(0, '127.0.0.1');
afterAll(() => server.close());

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/api/sites/site1/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /sites/:siteId/campaigns — welcome', () => {
  it('creates a site-wide welcome campaign (no pillar) with editable template steps when AI is unavailable', async () => {
    const res = await post({ audience: 'welcome' });
    expect(res.status).toBe(201);
    const campaign = res.json.campaign as Record<string, unknown>;
    expect(campaign).toMatchObject({ audience: 'welcome', status: 'draft', name: 'Acme Plumbing & Heating — Welcome' });
    expect('pillarId' in campaign || 'keyword' in campaign).toBe(false);

    const store = await getCampaignStore();
    const steps = await store.listSteps('site1', campaign.id as string);
    expect(steps.map((s) => s.subject)).toEqual([
      'Welcome to Acme Plumbing & Heating',
      'What we do at Acme Plumbing & Heating',
      'How can Acme Plumbing & Heating help?',
    ]);
    expect(steps.every((s) => s.campaignId === campaign.id)).toBe(true);
  });

  it('rejects a second welcome campaign with a 409 and leaves the first alone', async () => {
    expect((await post({ audience: 'welcome' })).status).toBe(201);
    const second = await post({ audience: 'welcome' });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatch(/already has a welcome campaign/);
    expect(await (await getCampaignStore()).listCampaigns('site1')).toHaveLength(1);
  });

  it('counts toward emailAutomationsPerSite', async () => {
    const store = await getCampaignStore();
    for (const id of ['p1', 'p2', 'p3']) {
      await store.saveCampaign({
        id,
        siteId: 'site1',
        pillarId: id,
        keyword: id,
        name: id,
        status: 'draft',
        createdAt: '',
        updatedAt: '',
      });
    }
    const res = await post({ audience: 'welcome' }); // pro allows 3 per site
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ feature: 'emailAutomationsPerSite', upgradeRequired: true });

    planTier = 'free';
    await rm(TEST_DATA, { recursive: true, force: true });
    expect((await post({ audience: 'welcome' })).json).toMatchObject({ feature: 'emailAutomationsPerSite' });
  });

  it('still requires pillarId for a pillar campaign', async () => {
    expect((await post({})).status).toBe(400);
  });
});

describe('POST /sites/:siteId/campaigns — pillar', () => {
  it('creates a draft campaign for the pillar', async () => {
    const res = await post({ pillarId: 'p1' });
    expect(res.status).toBe(201);
    expect(res.json.campaign).toMatchObject({ pillarId: 'p1', keyword: 'p1 keyword', status: 'draft' });
  });

  it('rejects a second campaign for the same pillar with a 409, whatever the first one\'s status', async () => {
    expect((await post({ pillarId: 'p1' })).status).toBe(201);
    const store = await getCampaignStore();
    const [first] = await store.listCampaigns('site1');
    for (const status of ['draft', 'active', 'paused'] as const) {
      await store.saveCampaign({ ...first, status, ...(status === 'active' ? { engine: 'native' as const } : {}) });
      const second = await post({ pillarId: 'p1' });
      expect(second.status).toBe(409);
      expect(second.json.error).toMatch(/already has a campaign/);
    }
    expect(await store.listCampaigns('site1')).toHaveLength(1);
  });

  it('treats a legacy campaign record (no audience) as the pillar\'s campaign', async () => {
    await (await getCampaignStore()).saveCampaign({
      id: 'legacy',
      siteId: 'site1',
      pillarId: 'p1',
      keyword: 'p1',
      name: 'Legacy',
      status: 'paused',
      createdAt: '',
      updatedAt: '',
    });
    expect((await post({ pillarId: 'p1' })).status).toBe(409);
  });

  it('still allows other pillars, and a welcome campaign blocks none of them', async () => {
    expect((await post({ audience: 'welcome' })).status).toBe(201);
    expect((await post({ pillarId: 'p1' })).status).toBe(201);
    expect((await post({ pillarId: 'p2' })).status).toBe(201);
    expect(await (await getCampaignStore()).listCampaigns('site1')).toHaveLength(3);
  });
});

describe('buildWelcomeSteps', () => {
  it('falls back to the template steps when the AI call fails', async () => {
    callAiJson.mockRejectedValueOnce(new Error('Anthropic API error: 529'));
    const steps = await buildWelcomeSteps('site1', SITE, AI);
    expect(steps).toHaveLength(3);
    expect(steps[0].subject).toBe('Welcome to Acme Plumbing & Heating');
  });

  it('falls back when the AI returns nothing usable', async () => {
    callAiJson.mockResolvedValueOnce('[{"title": "no subject or body"}]');
    expect((await buildWelcomeSteps('site1', SITE, AI))[0].subject).toBe('Welcome to Acme Plumbing & Heating');
    callAiJson.mockResolvedValueOnce('Sorry, I cannot help with that.');
    expect(await buildWelcomeSteps('site1', SITE, AI)).toHaveLength(3);
  });

  it('keeps at most 3 AI emails and normalizes their delays', async () => {
    const row = (n: number, delay: unknown) => ({
      subject: `S${n}`,
      preview_text: `P${n}`,
      body_html: `<p>${n}</p>`,
      delay_days: delay,
    });
    callAiJson.mockResolvedValueOnce(JSON.stringify({ emails: [row(1, 0), row(2, '2'), row(3, -4), row(4, 7)] }));
    const steps = await buildWelcomeSteps('site1', SITE, AI);
    expect(steps.map((s) => [s.subject, s.delayDays, s.order])).toEqual([
      ['S1', 0, 0],
      ['S2', 2, 1],
      ['S3', 4, 2],
    ]);
  });

  it("prompts with the site's name, approved brand voice and published page copy, home page first", async () => {
    getBrandResearch.mockResolvedValueOnce({
      siteId: 'site1',
      enabled: true,
      inputs: {},
      docs: { voiceSummary: { approved: true, summary: 'Warm, plain-spoken, no jargon.' } },
      updatedAt: '',
    });
    callAiJson.mockResolvedValueOnce('[]');
    await buildWelcomeSteps('site1', SITE, AI);

    const context = callAiJson.mock.calls[0][1] as string;
    expect(context).toContain('Business: Acme Plumbing & Heating (acme.example)');
    expect(context).toContain('Warm, plain-spoken, no jargon.');
    expect(context).toContain('Emergency plumbing, boilers and heat pumps.');
    expect(context.indexOf('## Home')).toBeLessThan(context.indexOf('## About'));
    expect(context).not.toContain('Working-copy only');
  });

  it('never calls the AI without credentials', async () => {
    expect(await buildWelcomeSteps('site1', SITE, null)).toHaveLength(3);
    expect(callAiJson).not.toHaveBeenCalled();
  });
});

describe('welcomeFallbackSteps', () => {
  it('fills in the site name — escaped in the HTML, plain in the subject — with a 0/2/4-day cadence', () => {
    const steps = welcomeFallbackSteps('site1', { name: 'Bob <&> Sons' });
    expect(steps[0].subject).toBe('Welcome to Bob <&> Sons');
    expect(steps[0].bodyHtml).toContain('Bob &lt;&amp;&gt; Sons');
    expect(steps[0].bodyHtml).not.toContain('Bob <&>');
    expect(steps[2].bodyHtml).toContain('our website');
    expect(steps.map((s) => s.delayDays)).toEqual([0, 2, 4]);
    expect(steps.map((s) => s.order)).toEqual([0, 1, 2]);
  });
});
