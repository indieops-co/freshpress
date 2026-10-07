import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { requireOwner, requireSiteAccess } from '../auth/middleware.js';
import { assertUnderLimit, LimitExceededError, requireFeature } from '../auth/entitlements.js';
import { routeParam } from '../util/params.js';
import { getCampaignStore } from '../storage/campaigns.js';
import { getBlogSiloStore } from '../storage/blog-silo.js';
import { getBrandResearchStore } from '../storage/brand-research.js';
import { getHumanizerConfigStore } from '../storage/humanizer-config.js';
import { buildBrandVoiceContext } from '../content/brand-voice-context.js';
import { escapeHtml } from '../content/render.js';
import { resolveAiKeys } from '../integrations/resolve.js';
import { callAiJson, extractJsonValue } from '../ai/call-json.js';
import { hasProviderCredentials } from '../email/providers/index.js';
import { isWelcomeCampaign, normalizeDelayDays } from '../email/campaign-engine.js';
import { enrollExistingSubscribers } from '../email/campaign-enroll.js';
import { loadComposeInput } from './email-brand.js';
import { renderBrandedEmail } from '../email/brand-render.js';
import type { CampaignAudience, CampaignStep } from '../content/campaign-types.js';
import type { PageContent } from '../content/types.js';
import type { ResolvedAiKeys } from '../storage/integrations-types.js';
import type { Site } from '../storage/types.js';

const router = Router();

// Activating/pausing drives real sends through the email system, so it shares that tier gate (as signups do).
const requireEmailSystem = requireFeature('emailSystem');

const siteAuth = requireSiteAccess(async (siteId) => {
  const { getStorage } = await import('../storage/filesystem.js');
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

router.get('/sites/:siteId/campaigns', siteAuth, async (req, res) => {
  const store = await getCampaignStore();
  res.json(await store.listCampaigns(routeParam(req.params.siteId)));
});

/**
 * AI sequence output → ordered steps, campaignId left for the caller to fill in. OpenRouter's
 * json_object mode forces a top-level OBJECT, so models wrap the requested array (e.g.
 * {"emails": [...]}) — accept either. Rows without a subject and body are dropped; empty when
 * nothing is usable, so callers fall back to their non-AI steps.
 */
function parseAiSteps(text: string, siteId: string): CampaignStep[] {
  const value = extractJsonValue(text, 'array') ?? extractJsonValue(text, 'object');
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value).find(Array.isArray)
      : undefined;
  if (!Array.isArray(rows)) return [];
  const usable = rows.filter(
    (row): row is { subject: string; preview_text?: unknown; body_html: string; delay_days?: unknown } =>
      typeof row?.subject === 'string' &&
      !!row.subject.trim() &&
      typeof row.body_html === 'string' &&
      !!row.body_html.trim()
  );
  const now = new Date().toISOString();
  return usable.map((row, i) => ({
    id: nanoid(10),
    campaignId: '',
    siteId,
    order: i,
    subject: row.subject,
    previewText: typeof row.preview_text === 'string' ? row.preview_text : '',
    bodyHtml: row.body_html,
    // AI output: may be a string, negative or missing — never store a delay addDays can't use.
    delayDays: normalizeDelayDays(row.delay_days, i === 0 ? 0 : 2 + i),
    createdAt: now,
    updatedAt: now,
  }));
}

router.post('/sites/:siteId/campaigns', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { pillarId, audience } = req.body as { pillarId?: string; audience?: CampaignAudience };
    if (audience === 'welcome') {
      await createWelcomeCampaign(req, res, siteId);
      return;
    }
    if (!pillarId) {
      res.status(400).json({ error: 'pillarId is required' });
      return;
    }

    const existing = await (await getCampaignStore()).listCampaigns(siteId);
    // One per pillar, like the welcome campaign: a second would enroll the same signups and send them both
    // sequences. Any status counts — a paused or draft one can still go live. Welcome campaigns have no pillarId.
    if (existing.some((c) => c.pillarId === pillarId)) {
      res.status(409).json({
        error: 'This pillar already has a campaign. Open it from the campaign list to edit or activate it.',
      });
      return;
    }
    // Campaigns are the "email automations" of the tier matrix — enforce the per-site
    // count before any AI generation work. Free tier's limit is 0 (no email system).
    assertUnderLimit(req.auth?.planTier, 'emailAutomationsPerSite', existing.length);

    const blog = await getBlogSiloStore();
    const pillar = await blog.getPillar(siteId, pillarId);
    if (!pillar) {
      res.status(404).json({ error: 'Pillar not found' });
      return;
    }

    const posts = await blog.listPosts(siteId, pillarId);
    const published = posts.filter((p) => p.status === 'published' || p.bodyHtml.length > 20);

    const ai = await resolveAiKeys();
    let steps: CampaignStep[] = [];

    if (ai && published.length > 0) {
      const contentSummary = published
        .map((p) => `## ${p.title}\n${p.bodyHtml.replace(/<[^>]+>/g, ' ').slice(0, 500)}`)
        .join('\n\n');

      const prompt = `Generate a ${Math.min(5, published.length)}-email nurture sequence JSON array for keyword "${pillar.keyword}". Each item: subject, preview_text, body_html (simple HTML), delay_days. Email 1 from pillar content, then supportive posts, last email soft CTA. Return ONLY JSON array.`;

      // Best-effort: any AI failure (provider error, truncation, malformed
      // JSON) falls through to the simple non-AI steps below. The shared
      // wrapper also fixes the content[0].text read newer Anthropic models
      // break by leading with non-text blocks.
      try {
        const text = await callAiJson(prompt, contentSummary, ai, { maxTokens: 8192 });
        steps = parseAiSteps(text, siteId).map((s, i) => ({ ...s, sourcePostId: published[i]?.id }));
      } catch (err) {
        console.warn(`[campaigns] AI sequence generation failed for ${siteId}; using fallback steps:`, err);
      }
    }

    if (steps.length === 0) {
      const now = new Date().toISOString();
      steps = published.slice(0, 3).map((p, i) => ({
        id: nanoid(10),
        campaignId: '',
        siteId,
        order: i,
        subject: p.title,
        previewText: p.metaDescription ?? '',
        bodyHtml: `<p>${p.title}</p>${p.bodyHtml.slice(0, 400)}`,
        delayDays: i === 0 ? 0 : 2 * i,
        sourcePostId: p.id,
        createdAt: now,
        updatedAt: now,
      }));
    }

    const campStore = await getCampaignStore();
    const campaign = await campStore.createCampaign(siteId, {
      pillarId,
      keyword: pillar.keyword,
      name: `${pillar.title} — Lead Nurture`,
    });

    steps = steps.map((s) => ({ ...s, campaignId: campaign.id }));
    await campStore.saveSteps(siteId, campaign.id, steps);

    res.status(201).json({ campaign, steps });
  } catch (err) {
    if (err instanceof LimitExceededError) {
      res.status(err.status).json(err.body);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Create campaign failed' });
  }
});

const WELCOME_EMAILS = 3;

/** A page's copy in page order. Text slot values are plain text (the renderer escapes them). */
function pageText(content: PageContent): string {
  return content.slotOrder
    .map((id) => content.slots[id])
    .filter((slot) => slot?.type === 'text')
    .map((slot) => slot.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What the site says about the business, for the welcome prompt: its name and domain, approved
 * Deep Brand Research + brand-voice skill (the same enrichment social posts get), and its
 * published pages' copy, home page first. Every source is best-effort — none may block creation.
 */
async function loadWelcomeContext(siteId: string, site: Site): Promise<string> {
  const { getPublishedSnapshot } = await import('../publish/service.js');
  const [research, humanizer, snapshot] = await Promise.allSettled([
    getBrandResearchStore().then((s) => s.get(siteId)),
    getHumanizerConfigStore().then((s) => s.getSiteConfig(siteId)),
    getPublishedSnapshot(siteId),
  ]);
  const brandContext = buildBrandVoiceContext({
    brandResearch: research.status === 'fulfilled' ? research.value : undefined,
    brandVoiceSkill: humanizer.status === 'fulfilled' ? humanizer.value?.brandVoiceSkill : undefined,
  });
  // Published copy, not the working copy: it's what the subscriber saw when they signed up.
  const live = snapshot.status === 'fulfilled' ? snapshot.value?.pages : undefined;
  const pages = live
    ? site.pages
        .filter((p) => live[p.id])
        .sort((a, b) => Number(b.path === '/') - Number(a.path === '/'))
        .map((p) => ({ title: p.title, text: pageText(live[p.id]) }))
        .filter((p) => p.text)
        .slice(0, 6)
        .map((p) => `## ${p.title}\n${p.text.slice(0, 500)}`)
    : [];
  const business = `Business: ${site.meta.name}${site.meta.domain ? ` (${site.meta.domain})` : ''}`;
  return [business, brandContext, ...pages].filter(Boolean).join('\n\n');
}

/** Template steps — welcome, what we do, soft call to action — for when AI is unavailable or fails. */
export function welcomeFallbackSteps(siteId: string, site: Pick<Site['meta'], 'name' | 'domain'>): CampaignStep[] {
  const name = escapeHtml(site.name);
  const website = site.domain
    ? `<a href="https://${escapeHtml(site.domain)}">${escapeHtml(site.domain)}</a>`
    : 'our website';
  const emails = [
    {
      subject: `Welcome to ${site.name}`,
      previewText: "Thanks for subscribing — here's what to expect.",
      bodyHtml: `<p>Hi there,</p><p>Thanks for subscribing to ${name} — we're glad you're here.</p><p>We'll only email when we have something worth sharing, and you can unsubscribe any time with the link at the bottom of every email.</p>`,
    },
    {
      subject: `What we do at ${site.name}`,
      previewText: 'A quick look at how we can help.',
      bodyHtml: `<p>Hi again,</p><p>We'd like to tell you a little more about ${name} and how we help the people we work with.</p><p>The best place to see everything we offer is ${website} — take a look around when you have a minute.</p>`,
    },
    {
      subject: `How can ${site.name} help?`,
      previewText: "We're here when you're ready.",
      bodyHtml: `<p>Hi,</p><p>Whenever you're ready, we'd love to help. Visit ${website} to get in touch.</p><p>Thanks again for subscribing to ${name}.</p>`,
    },
  ];
  const now = new Date().toISOString();
  return emails.map((email, i) => ({
    id: nanoid(10),
    campaignId: '',
    siteId,
    order: i,
    ...email,
    delayDays: i === 0 ? 0 : 2 * i,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * The welcome campaign's starter steps: a short AI-written sequence grounded in what the site says
 * about the business, or the template steps when AI is unavailable or fails. Editable either way.
 */
export async function buildWelcomeSteps(
  siteId: string,
  site: Site,
  ai: ResolvedAiKeys | null
): Promise<CampaignStep[]> {
  if (ai) {
    const prompt = `Generate a ${WELCOME_EMAILS}-email welcome sequence JSON array for new subscribers to "${site.meta.name}" who signed up on its website (not from a blog post). Each item: subject, preview_text, body_html (simple HTML), delay_days. Email 1 welcomes them and says what to expect (delay_days 0), email 2 explains what the business does and who it helps, email 3 is a soft CTA. Use only facts from the business context — never invent offers, prices or guarantees. Return ONLY JSON array.`;
    // Best-effort, like the pillar sequence: any AI failure falls through to the template steps.
    try {
      const text = await callAiJson(prompt, await loadWelcomeContext(siteId, site), ai, { maxTokens: 4096 });
      const steps = parseAiSteps(text, siteId).slice(0, WELCOME_EMAILS);
      if (steps.length > 0) return steps;
    } catch (err) {
      console.warn(`[campaigns] AI welcome sequence generation failed for ${siteId}; using template steps:`, err);
    }
  }
  return welcomeFallbackSteps(siteId, site.meta);
}

/** POST /campaigns with `audience: 'welcome'` — the site's catch-all campaign. Errors propagate to the route's catch. */
async function createWelcomeCampaign(req: Request, res: Response, siteId: string): Promise<void> {
  const campStore = await getCampaignStore();
  const existing = await campStore.listCampaigns(siteId);
  // One per site: a second catch-all could only compete with the first for the same signups.
  if (existing.some(isWelcomeCampaign)) {
    res.status(409).json({
      error: 'This site already has a welcome campaign. Open it from the campaign list to edit or activate it.',
    });
    return;
  }
  // Counts toward the same per-site automations limit as pillar campaigns.
  assertUnderLimit(req.auth?.planTier, 'emailAutomationsPerSite', existing.length);

  const { getStorage } = await import('../storage/filesystem.js');
  const site = await (await getStorage()).getSite(siteId);
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }

  const steps = await buildWelcomeSteps(siteId, site, await resolveAiKeys());
  const campaign = await campStore.createCampaign(siteId, { audience: 'welcome', name: `${site.meta.name} — Welcome` });
  const saved = steps.map((s) => ({ ...s, campaignId: campaign.id }));
  await campStore.saveSteps(siteId, campaign.id, saved);
  res.status(201).json({ campaign, steps: saved });
}

router.get('/sites/:siteId/campaigns/:campaignId', siteAuth, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const campaignId = routeParam(req.params.campaignId);
  const store = await getCampaignStore();
  const campaign = await store.getCampaign(siteId, campaignId);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const steps = await store.listSteps(siteId, campaignId);
  const enrollments = await store.listEnrollments(siteId, campaignId);
  res.json({
    campaign,
    steps,
    enrollments: {
      active: enrollments.filter((e) => e.status === 'active').length,
      completed: enrollments.filter((e) => e.status === 'completed').length,
      stopped: enrollments.filter((e) => e.status === 'stopped').length,
    },
  });
});

export async function renderStepEmailHtml(
  siteId: string,
  step: CampaignStep,
  siteName: string
): Promise<string> {
  if (!step.formatId || !step.templateId) return step.bodyHtml;
  try {
    const input = await loadComposeInput(
      siteId,
      {
        formatId: step.formatId,
        templateId: step.templateId,
        subject: step.subject,
        previewText: step.previewText,
        bodyHtml: step.bodyHtml,
        includeBrand: step.includeBrand ?? true,
        includeSignature: step.includeSignature ?? true,
      },
      siteName
    );
    return await renderBrandedEmail(input);
  } catch {
    return step.bodyHtml;
  }
}

/**
 * Activate a campaign — native sequences (no Resend Automations). New confirmed
 * subscribers who signed up on this campaign's pillar pages (for the welcome campaign:
 * anywhere no live pillar campaign covers) enroll automatically
 * via the subscriber.confirmed trigger; pass `enrollExisting: true` to also enroll
 * matching subscribers who confirmed before activation (opt-in, so activating can
 * never mass-email by surprise). Also how a legacy Resend-era campaign goes live.
 */
router.post('/sites/:siteId/campaigns/:campaignId/activate', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const campaignId = routeParam(req.params.campaignId);
    const store = await getCampaignStore();
    const campaign = await store.getCampaign(siteId, campaignId);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const steps = await store.listSteps(siteId, campaignId);
    if (steps.length === 0) {
      res.status(400).json({ error: 'Campaign has no steps to send' });
      return;
    }

    const { getStorage } = await import('../storage/filesystem.js');
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site?.meta.email?.enabled || !hasProviderCredentials(site.meta.email)) {
      res.status(400).json({ error: 'Connect an email provider in Site Settings → Email first' });
      return;
    }

    campaign.status = 'active';
    campaign.engine = 'native';
    campaign.activatedAt = new Date().toISOString();
    await store.saveCampaign(campaign);

    let enrolledExisting = 0;
    if ((req.body as { enrollExisting?: boolean })?.enrollExisting) {
      enrolledExisting = await enrollExistingSubscribers(campaign, steps, await storage.listSubscribers(siteId));
    }

    res.json({ campaign, enrolledExisting });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Activate failed' });
  }
});

/** Pause a campaign — active enrollments hold their place and resume on reactivation. */
router.post('/sites/:siteId/campaigns/:campaignId/pause', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const store = await getCampaignStore();
    const campaign = await store.getCampaign(siteId, routeParam(req.params.campaignId));
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    campaign.status = 'paused';
    await store.saveCampaign(campaign);
    res.json({ campaign });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Pause failed' });
  }
});

export default router;
