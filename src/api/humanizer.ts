import { Router } from 'express';
import { requireOwner } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { getHumanizerConfigStore } from '../storage/humanizer-config.js';
import { getStorage } from '../storage/filesystem.js';
import { getCampaignStore } from '../storage/campaigns.js';
import { normalizeDelayDays } from '../email/campaign-engine.js';
import { humanizeHtml, resolveStyleAddition } from '../humanizer/humanize.js';
import { detectAiContent } from '../blog/detection.js';
import { loadManifest, syncUpstreamSkill } from '../humanizer/loader.js';
import { buildHumanizerPrompt } from '../humanizer/build-prompt.js';
import type { HumanizerContentType, HumanizerMode } from '../humanizer/types.js';

const router = Router();

function parseHumanizeBody(body: unknown): {
  mode?: HumanizerMode;
  includeReview?: boolean;
  html?: string;
  contentType?: HumanizerContentType;
} {
  const b = body as Record<string, unknown>;
  return {
    mode: b.mode === 'skill' || b.mode === 'simple' ? b.mode : undefined,
    includeReview: b.includeReview === true,
    html: typeof b.html === 'string' ? b.html : undefined,
    contentType:
      b.contentType === 'blog' || b.contentType === 'email' || b.contentType === 'auto'
        ? b.contentType
        : undefined,
  };
}

router.get('/sites/:siteId/humanizer-config', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const store = await getHumanizerConfigStore();
    const config = await store.getOrCreateSiteConfig(siteId);
    const manifest = await loadManifest().catch(() => null);
    res.json({ config, upstream: manifest });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load config' });
  }
});

router.put('/sites/:siteId/humanizer-config', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const store = await getHumanizerConfigStore();
    const existing = await store.getOrCreateSiteConfig(siteId);
    const body = req.body as Partial<typeof existing>;
    const saved = await store.saveSiteConfig({
      ...existing,
      ...body,
      siteId,
    });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save config' });
  }
});

router.get('/admin/humanizer/defaults', requireOwner, async (_req, res) => {
  try {
    const store = await getHumanizerConfigStore();
    const defaults = await store.getWorkspaceDefaults();
    const manifest = await loadManifest().catch(() => null);
    res.json({ defaults, upstream: manifest });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load defaults' });
  }
});

router.put('/admin/humanizer/defaults', requireOwner, async (req, res) => {
  try {
    const store = await getHumanizerConfigStore();
    const existing = await store.getWorkspaceDefaults();
    const body = req.body as Partial<typeof existing>;
    const saved = await store.saveWorkspaceDefaults({ ...existing, ...body });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save defaults' });
  }
});

router.post('/admin/humanizer/sync-upstream', requireOwner, async (_req, res) => {
  try {
    const manifest = await syncUpstreamSkill();
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

router.get('/sites/:siteId/humanizer/prompt-preview', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const store = await getHumanizerConfigStore();
    const config = await store.getOrCreateSiteConfig(siteId);
    const styleAddition = await resolveStyleAddition(siteId);
    const prompt = await buildHumanizerPrompt({
      config,
      contentType: config.contentTypeHint ?? 'auto',
      includeReview: false,
      styleGuideAddition: styleAddition,
    });
    res.json({ length: prompt.length, estimatedTokens: Math.ceil(prompt.length / 4) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

router.post('/sites/:siteId/humanizer/detect-ai', requireOwner, async (req, res) => {
  try {
    const { html } = req.body as { html?: string };
    if (!html) {
      res.status(400).json({ error: 'html is required' });
      return;
    }
    const result = await detectAiContent(html);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Detection failed' });
  }
});

router.post('/sites/:siteId/humanizer/humanize', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { mode, includeReview, html, contentType } = parseHumanizeBody(req.body);
    if (!html) {
      res.status(400).json({ error: 'html is required' });
      return;
    }
    const result = await humanizeHtml({ html, siteId, mode, includeReview, contentType });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Humanize failed' });
  }
});

router.post('/sites/:siteId/pages/:pageId/slots/:slotId/humanize', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const pageId = routeParam(req.params.pageId);
    const slotId = routeParam(req.params.slotId);
    const { mode, includeReview, html, contentType } = parseHumanizeBody(req.body);

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    const page = site?.pages.find((p) => p.id === pageId);
    const slot = page?.content.slots[slotId];
    if (!slot) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    const inputHtml = html ?? (slot.value.includes('<') ? slot.value : `<p>${slot.value}</p>`);
    const result = await humanizeHtml({
      html: inputHtml,
      siteId,
      mode,
      includeReview,
      contentType: contentType ?? 'blog',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Humanize failed' });
  }
});

router.post(
  '/sites/:siteId/campaigns/:campaignId/steps/:stepId/humanize',
  requireOwner,
  async (req, res) => {
    try {
      const siteId = routeParam(req.params.siteId);
      const campaignId = routeParam(req.params.campaignId);
      const stepId = routeParam(req.params.stepId);
      const { mode, includeReview, html } = parseHumanizeBody(req.body);

      const store = await getCampaignStore();
      const steps = await store.listSteps(siteId, campaignId);
      const step = steps.find((s) => s.id === stepId);
      if (!step) {
        res.status(404).json({ error: 'Step not found' });
        return;
      }

      const result = await humanizeHtml({
        html: html ?? step.bodyHtml,
        siteId,
        mode,
        includeReview,
        contentType: 'email',
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Humanize failed' });
    }
  }
);

router.patch('/sites/:siteId/campaigns/:campaignId/steps/:stepId', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const campaignId = routeParam(req.params.campaignId);
    const stepId = routeParam(req.params.stepId);
    const store = await getCampaignStore();
    const steps = await store.listSteps(siteId, campaignId);
    const step = steps.find((s) => s.id === stepId);
    if (!step) {
      res.status(404).json({ error: 'Step not found' });
      return;
    }
    const patch = req.body as Partial<typeof step>;
    const updated = {
      ...step,
      ...patch,
      // Drives send timing — coerce, keeping the current value if the patch's is unusable.
      delayDays: normalizeDelayDays(patch.delayDays, normalizeDelayDays(step.delayDays)),
      id: step.id,
      campaignId,
      siteId,
      updatedAt: new Date().toISOString(),
    };
    await store.saveSteps(siteId, campaignId, steps.map((s) => (s.id === stepId ? updated : s)));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

export default router;
