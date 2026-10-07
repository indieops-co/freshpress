import { Router } from 'express';
import { nanoid } from 'nanoid';
import { requireAdmin, requireSiteMember, adminOnly } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { getSocialConfigStore } from '../storage/social-config.js';
import { getSocialPostsStore } from '../storage/social-posts.js';
import { getBlogSiloStore } from '../storage/blog-silo.js';
import { getStorage } from '../storage/filesystem.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { generateSocialBatch } from '../social/generate.js';
import { generateTextCardsForSite } from '../social/text-card.js';
import { humanizeHtml } from '../humanizer/humanize.js';
import { detectAiContent } from '../blog/detection.js';
import type { AcceptVariantSelection, SocialSiteConfig } from '../content/social-types.js';
import { SocialSiteConfigSchema } from '../content/social-types.js';

const router = Router();

const siteAuth = requireSiteMember(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

async function getSiteDomain(siteId: string): Promise<string | undefined> {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.domain;
}

// ── Config (admin only) ────────────────────────────────────────

router.get('/sites/:siteId/social-config', siteAuth, adminOnly, async (req, res) => {
  const store = await getSocialConfigStore();
  res.json(await store.getOrCreateConfig(routeParam(req.params.siteId)));
});

router.put('/sites/:siteId/social-config', siteAuth, adminOnly, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const store = await getSocialConfigStore();
    const existing = await store.getOrCreateConfig(siteId);
    const body = req.body as Partial<SocialSiteConfig>;
    const merged = SocialSiteConfigSchema.parse({
      ...existing,
      ...body,
      siteId,
      accounts: body.accounts ?? existing.accounts,
    });
    res.json(await store.saveConfig(merged));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid config' });
  }
});

// ── Generate (admin only) ───────────────────────────────────────

router.post('/sites/:siteId/blog/posts/:postId/social/generate', siteAuth, adminOnly, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const postId = routeParam(req.params.postId);
    const { includeFullScreenCards } = req.body as { includeFullScreenCards?: boolean };

    const blog = await getBlogSiloStore();
    const post = await blog.getPost(siteId, postId);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    if (post.status !== 'published') {
      res.status(400).json({ error: 'Post must be published to generate social drafts' });
      return;
    }

    const configStore = await getSocialConfigStore();
    const config = await configStore.getOrCreateConfig(siteId);
    const included = config.accounts.filter((a) => a.included);
    if (included.length === 0) {
      res.status(400).json({ error: 'No included social accounts — configure in Site Settings → Social' });
      return;
    }

    const domain = await getSiteDomain(siteId);
    const result = await generateSocialBatch({
      siteId,
      post,
      accounts: config.accounts,
      includeFullScreenCards: includeFullScreenCards ?? config.defaultFullScreenCards,
      siteDomain: domain,
    });

    await blog.savePost({ ...post, socialGenerationMeta: result.updatedMeta });

    const postsStore = await getSocialPostsStore();
    const batch = await postsStore.createBatch(result.batch);

    res.status(201).json({ batch, overlapWarning: result.overlapWarning });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

// ── Batches (admin only) ────────────────────────────────────────

router.get('/sites/:siteId/social/batches', siteAuth, adminOnly, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const { sourcePostId, status } = req.query as { sourcePostId?: string; status?: string };
  const store = await getSocialPostsStore();
  res.json(await store.listBatches(siteId, { sourcePostId, status }));
});

router.get('/sites/:siteId/social/batches/:batchId', siteAuth, adminOnly, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const batchId = routeParam(req.params.batchId);
  const store = await getSocialPostsStore();
  const batch = await store.getBatch(siteId, batchId);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.json(batch);
});

router.post('/sites/:siteId/social/batches/:batchId/accept', siteAuth, adminOnly, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const batchId = routeParam(req.params.batchId);
    const { selections } = req.body as { selections?: AcceptVariantSelection[] };
    if (!selections?.length) {
      res.status(400).json({ error: 'selections required' });
      return;
    }

    const store = await getSocialPostsStore();
    const batch = await store.getBatch(siteId, batchId);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const configStore = await getSocialConfigStore();
    const config = await configStore.getOrCreateConfig(siteId);

    const drafts = [];
    for (const sel of selections) {
      const variant = batch.variants.find((v) => v.id === sel.variantId);
      if (!variant) continue;

      const account = config.accounts.find((a) => a.platform === variant.platform && a.included);
      if (!account) continue;

      const images: { hero?: string; textCardLight?: string; textCardDark?: string } = {};
      if (sel.includeHero !== false && variant.images.hero) images.hero = variant.images.hero.url;
      if (sel.includeTextCardLight !== false && variant.images.textCardLight)
        images.textCardLight = variant.images.textCardLight.url;
      if (sel.includeTextCardDark !== false && variant.images.textCardDark)
        images.textCardDark = variant.images.textCardDark.url;

      const draft = await store.createDraft({
        siteId,
        sourcePostId: batch.sourcePostId,
        batchId: batch.id,
        platform: variant.platform,
        accountId: account.id,
        bodyText: variant.bodyText,
        tags: variant.suggestedTags,
        targetKeywords: batch.targetKeywords,
        sourceSection: batch.sourceSection,
        generationRun: batch.generationRun,
        images,
      });
      drafts.push(draft);
    }

    const acceptedCount = drafts.length;
    const totalPlatforms = new Set(batch.variants.map((v) => v.platform)).size;
    const newStatus =
      acceptedCount >= totalPlatforms * 2
        ? 'completed'
        : acceptedCount > 0
          ? 'partially_accepted'
          : batch.status;

    await store.saveBatch({ ...batch, status: newStatus });

    res.status(201).json({ drafts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Accept failed' });
  }
});

// ── Drafts (admin + client) ─────────────────────────────────────

router.get('/sites/:siteId/social/drafts', siteAuth, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const { sourcePostId, platform, status } = req.query as {
    sourcePostId?: string;
    platform?: string;
    status?: string;
  };
  const store = await getSocialPostsStore();
  res.json(await store.listDrafts(siteId, { sourcePostId, platform, status }));
});

router.get('/sites/:siteId/social/drafts/:draftId', siteAuth, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const draftId = routeParam(req.params.draftId);
  const store = await getSocialPostsStore();
  const draft = await store.getDraft(siteId, draftId);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  const domain = await getSiteDomain(siteId);
  const blog = await getBlogSiloStore();
  const post = await blog.getPost(siteId, draft.sourcePostId);
  const blogUrl =
    post && domain
      ? `https://${domain}/blog/${post.slug}.html`
      : post?.canonicalUrl;

  res.json({ draft, blogUrl });
});

router.patch('/sites/:siteId/social/drafts/:draftId', siteAuth, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const draftId = routeParam(req.params.draftId);
    const store = await getSocialPostsStore();
    const draft = await store.getDraft(siteId, draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    const body = req.body as Partial<typeof draft>;
    const updated = await store.saveDraft({
      ...draft,
      bodyText: body.bodyText ?? draft.bodyText,
      tags: body.tags ?? draft.tags,
      images: body.images ?? draft.images,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

router.post('/sites/:siteId/social/drafts/:draftId/publish', siteAuth, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const draftId = routeParam(req.params.draftId);
    const store = await getSocialPostsStore();
    const draft = await store.getDraft(siteId, draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const updated = await store.saveDraft({
      ...draft,
      status: 'published',
      publishedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Mark published failed' });
  }
});

router.post('/sites/:siteId/social/drafts/:draftId/regenerate-cards', siteAuth, adminOnly, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const draftId = routeParam(req.params.draftId);
    const store = await getSocialPostsStore();
    const draft = await store.getDraft(siteId, draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    const styleStore = await getStyleGuideStore();
    const styleGuide = await styleStore.get(siteId);
    const storage = await getStorage();
    const cards = await generateTextCardsForSite(
      siteId,
      storage.getSitePublicDir(siteId),
      draft.bodyText.slice(0, 120),
      draft.targetKeywords[0] ?? '',
      styleGuide
    );

    const updated = await store.saveDraft({
      ...draft,
      images: {
        ...draft.images,
        textCardLight: cards.textCardLight,
        textCardDark: cards.textCardDark,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Regenerate failed' });
  }
});

router.post('/sites/:siteId/social/drafts/:draftId/humanize', siteAuth, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const draftId = routeParam(req.params.draftId);
    const body = req.body as { html?: string; mode?: 'simple' | 'skill'; includeReview?: boolean };
    const store = await getSocialPostsStore();
    const draft = await store.getDraft(siteId, draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const result = await humanizeHtml({
      html: body.html ?? draft.bodyText,
      siteId,
      mode: body.mode,
      includeReview: body.includeReview === true,
      contentType: 'social',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Humanize failed' });
  }
});

router.post('/sites/:siteId/social/drafts/:draftId/detect-ai', siteAuth, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const draftId = routeParam(req.params.draftId);
    const body = req.body as { html?: string };
    const store = await getSocialPostsStore();
    const draft = await store.getDraft(siteId, draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const result = await detectAiContent(body.html ?? draft.bodyText);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Detection failed' });
  }
});

/** Shared helper for blog PATCH auto-generate */
export async function maybeAutoGenerateSocial(
  siteId: string,
  postId: string,
  wasPublished: boolean,
  isPublished: boolean
): Promise<void> {
  if (isPublished && !wasPublished) {
    const configStore = await getSocialConfigStore();
    const config = await configStore.getOrCreateConfig(siteId);
    if (!config.autoGenerateOnPublish) return;
    if (!config.accounts.some((a) => a.included)) return;

    const blog = await getBlogSiloStore();
    const post = await blog.getPost(siteId, postId);
    if (!post) return;

    try {
      const domain = await getSiteDomain(siteId);
      const result = await generateSocialBatch({
        siteId,
        post,
        accounts: config.accounts,
        includeFullScreenCards: config.defaultFullScreenCards,
        siteDomain: domain,
      });
      await blog.savePost({ ...post, socialGenerationMeta: result.updatedMeta });
      const postsStore = await getSocialPostsStore();
      await postsStore.createBatch(result.batch);
    } catch (err) {
      console.error('[social] auto-generate failed:', err instanceof Error ? err.message : err);
    }
  }
}

export default router;
