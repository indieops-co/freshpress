import { Router } from 'express';
import { requireOwner, requireSiteAccess } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { getBlogSiloStore } from '../storage/blog-silo.js';
import { applyAutoSeo } from '../blog/auto-seo.js';
import { humanizeHtml } from '../humanizer/humanize.js';
import type { HumanizerContentType, HumanizerMode } from '../humanizer/types.js';
import { detectAiContent } from '../blog/detection.js';
import { getRssFeedStore } from '../storage/rss-feeds.js';
import { getSeoPrompt, applySiteContext } from '../seo-prompts/loader.js';

const router = Router();

const siteAuth = requireSiteAccess(async (siteId) => {
  const { getStorage } = await import('../storage/filesystem.js');
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

router.get('/sites/:siteId/blog/silos', siteAuth, async (req, res) => {
  const store = await getBlogSiloStore();
  res.json(await store.listSilos(routeParam(req.params.siteId)));
});

router.post('/sites/:siteId/blog/pillars', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { keyword, slug, title } = req.body as {
      keyword?: string;
      slug?: string;
      title?: string;
    };
    if (!keyword || !slug || !title) {
      res.status(400).json({ error: 'keyword, slug, and title are required' });
      return;
    }
    const store = await getBlogSiloStore();
    const pillar = await store.createPillar(siteId, { keyword, slug, title });
    const pillarPost = await store.createPost(siteId, {
      pillarId: pillar.id,
      kind: 'pillar',
      title,
      slug,
      keyword,
      bodyHtml: '<p></p>',
    });
    res.status(201).json({ pillar, pillarPost });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Create pillar failed' });
  }
});

router.post('/sites/:siteId/blog/pillars/:pillarId/posts', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const pillarId = routeParam(req.params.pillarId);
    const { title, slug } = req.body as { title?: string; slug?: string };
    const store = await getBlogSiloStore();
    const pillar = await store.getPillar(siteId, pillarId);
    if (!pillar) {
      res.status(404).json({ error: 'Pillar not found' });
      return;
    }
    if (!title || !slug) {
      res.status(400).json({ error: 'title and slug are required' });
      return;
    }
    const post = await store.createPost(siteId, {
      pillarId,
      kind: 'supportive',
      title,
      slug,
      keyword: pillar.keyword,
    });
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Create post failed' });
  }
});

router.get('/sites/:siteId/blog/posts/:postId', siteAuth, async (req, res) => {
  const store = await getBlogSiloStore();
  const post = await store.getPost(routeParam(req.params.siteId), routeParam(req.params.postId));
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  res.json(post);
});

router.patch('/sites/:siteId/blog/posts/:postId', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const postId = routeParam(req.params.postId);
    const store = await getBlogSiloStore();
    const post = await store.getPost(siteId, postId);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    const wasPublished = post.status === 'published';
    const patch = req.body as Partial<typeof post>;
    const merged = {
      ...post,
      ...patch,
      id: post.id,
      siteId,
      pillarId: post.pillarId,
      kind: post.kind,
    };
    if (merged.status === 'published' && !merged.publishedAt) {
      merged.publishedAt = new Date().toISOString();
    }
    const updated = await store.savePost(applyAutoSeo(merged));

    const { maybeAutoGenerateSocial } = await import('./social-posts.js');
    void maybeAutoGenerateSocial(siteId, postId, wasPublished, updated.status === 'published');

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

router.post('/sites/:siteId/blog/posts/:postId/humanize', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const postId = routeParam(req.params.postId);
    const body = req.body as {
      mode?: HumanizerMode;
      includeReview?: boolean;
      html?: string;
    };
    const store = await getBlogSiloStore();
    const post = await store.getPost(siteId, postId);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    const result = await humanizeHtml({
      html: body.html ?? post.bodyHtml,
      siteId,
      mode: body.mode,
      includeReview: body.includeReview === true,
      contentType: 'blog' as HumanizerContentType,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Humanize failed' });
  }
});

router.post('/sites/:siteId/blog/posts/:postId/detect-ai', requireOwner, async (req, res) => {
  try {
    const store = await getBlogSiloStore();
    const post = await store.getPost(routeParam(req.params.siteId), routeParam(req.params.postId));
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    const body = req.body as { html?: string };
    const result = await detectAiContent(body.html ?? post.bodyHtml);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Detection failed' });
  }
});

router.get('/sites/:siteId/blog/rss-feeds', siteAuth, async (req, res) => {
  const feeds = await getRssFeedStore();
  res.json(await feeds.list(routeParam(req.params.siteId)));
});

router.post('/sites/:siteId/blog/rss-feeds', requireOwner, async (req, res) => {
  const { url, label } = req.body as { url?: string; label?: string };
  if (!url || !label) {
    res.status(400).json({ error: 'url and label required' });
    return;
  }
  const feeds = await getRssFeedStore();
  res.status(201).json(await feeds.add(routeParam(req.params.siteId), url, label));
});

const BLOG_RECIPE_IDS = ['recipe-1', 'recipe-4', 'recipe-6', 'recipe-7', 'recipe-12', 'recipe-13'] as const;

router.get('/sites/:siteId/blog/posts/:postId/seo-recipes', siteAuth, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const postId = routeParam(req.params.postId);
  const store = await getBlogSiloStore();
  const post = await store.getPost(siteId, postId);
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const { getStorage } = await import('../storage/filesystem.js');
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  const siteUrl = site?.meta.domain ? `https://${site.meta.domain}` : process.env.APP_URL ?? 'https://example.com';
  const pageUrl = `${siteUrl}/blog/${post.slug}.html`;

  const recipes = [];
  for (const id of BLOG_RECIPE_IDS) {
    const prompt = await getSeoPrompt(id);
    if (!prompt) continue;
    recipes.push({
      id: prompt.id,
      number: prompt.number,
      title: prompt.title,
      description: prompt.description,
    });
  }

  res.json({ postId, keyword: post.keyword, pageUrl, recipes });
});

router.get('/sites/:siteId/blog/posts/:postId/seo-recipes/:recipeId', siteAuth, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const postId = routeParam(req.params.postId);
  const recipeId = routeParam(req.params.recipeId);

  const store = await getBlogSiloStore();
  const post = await store.getPost(siteId, postId);
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const prompt = await getSeoPrompt(recipeId);
  if (!prompt) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const { getStorage } = await import('../storage/filesystem.js');
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  const siteUrl = site?.meta.domain ? `https://${site.meta.domain}` : process.env.APP_URL ?? 'https://example.com';
  const pageUrl = `${siteUrl}/blog/${post.slug}.html`;

  let content = applySiteContext(prompt.content, { siteUrl, pageUrl });
  content = content.replace(/"keyword"/g, `"${post.keyword}"`);

  res.json({ id: prompt.id, title: prompt.title, content, pageUrl, keyword: post.keyword });
});

export default router;
