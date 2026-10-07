import { Router } from 'express';
import {
  loadSeoPromptCollections,
  getSeoPrompt,
  applySiteContext,
} from '../seo-prompts/loader.js';
import { requireOwner, requireSiteAccess } from '../auth/middleware.js';
import { getStorage } from '../storage/filesystem.js';
import { routeParam } from '../util/params.js';

const router = Router();

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

function summarizeCollections(collections: Awaited<ReturnType<typeof loadSeoPromptCollections>>) {
  return collections.map((col) => ({
    id: col.id,
    title: col.title,
    description: col.description,
    sourceUrl: col.sourceUrl,
    prompts: col.prompts.map(({ id, number, title, description, category }) => ({
      id,
      number,
      title,
      description,
      category,
    })),
  }));
}

async function resolveSiteContext(siteId: string, pageId?: string) {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  if (!site) return {};

  let pageUrl: string | undefined;
  if (pageId) {
    const page = site.pages.find((p) => p.id === pageId);
    if (page?.sourceUrl) pageUrl = page.sourceUrl;
    else if (site.meta.domain) pageUrl = `https://${site.meta.domain}${page?.path ?? '/'}`;
  }

  const siteUrl = site.meta.domain ? `https://${site.meta.domain}` : undefined;
  return { siteUrl, pageUrl };
}

/** Owner dashboard — list SEO prompt collections */
router.get('/seo-prompts', requireOwner, async (_req, res) => {
  try {
    const collections = await loadSeoPromptCollections();
    res.json(summarizeCollections(collections));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load SEO prompts' });
  }
});

/** Owner dashboard — get full prompt */
router.get('/seo-prompts/:promptId', requireOwner, async (req, res) => {
  try {
    const prompt = await getSeoPrompt(routeParam(req.params.promptId));
    if (!prompt) {
      res.status(404).json({ error: 'Prompt not found' });
      return;
    }
    res.json(prompt);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load prompt' });
  }
});

/** Editor — list prompts with site context available */
router.get('/sites/:siteId/seo-prompts', siteAuth, async (_req, res) => {
  try {
    const collections = await loadSeoPromptCollections();
    res.json(summarizeCollections(collections));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load SEO prompts' });
  }
});

/** Editor — get prompt with optional site/page URL substitution */
router.get('/sites/:siteId/seo-prompts/:promptId', siteAuth, async (req, res) => {
  try {
    const prompt = await getSeoPrompt(routeParam(req.params.promptId));
    if (!prompt) {
      res.status(404).json({ error: 'Prompt not found' });
      return;
    }

    const pageId = req.query.pageId as string | undefined;
    const ctx = await resolveSiteContext(routeParam(req.params.siteId), pageId);
    const content = applySiteContext(prompt.content, ctx);

    res.json({ ...prompt, content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load prompt' });
  }
});

export default router;
