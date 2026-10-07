import { Router } from 'express';
import { join, extname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { getStorage } from '../storage/filesystem.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { ingestUrl } from '../ingest/index.js';
import { renderPage } from '../content/render.js';
import { deriveNamedElements, reconcilePageNumbers } from '../content/named-elements.js';
import { validateChanges, mergeValidatedSlots } from '../guardian/validate.js';
import { validateGeneratedPage } from '../guardian/validate-generated-page.js';
import {
  requireOwner,
  requireSiteAccess,
  requireWorkspaceUser,
  requireWorkspaceAdmin,
  hashPassword,
  canActorPublish,
} from '../auth/middleware.js';
import { assertUnderLimit, LimitExceededError } from '../auth/entitlements.js';
import type { PageContent, SlotChange } from '../content/types.js';
import type { Site } from '../storage/types.js';
import { routeParam } from '../util/params.js';

function sanitizeSite(site: Site): Site {
  const { clientPasswordHash: _, email, ...metaRest } = site.meta;
  return {
    ...site,
    meta: {
      ...metaRest,
      ...(email
        ? {
            email: {
              enabled: email.enabled,
              provider: email.provider,
              fromEmail: email.fromEmail,
              fromName: email.fromName,
              notifyEmail: email.notifyEmail,
            },
          }
        : {}),
    },
  };
}

const router = Router();

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

// ── Sites (owner) ──────────────────────────────────────────────

// Listing sites is member-accessible so save-only members can navigate the dashboard.
router.get('/sites', requireWorkspaceUser, async (_req, res) => {
  const storage = await getStorage();
  const sites = await storage.listSites();
  res.json(sites);
});

router.post('/sites', requireOwner, async (req, res) => {
  try {
    const { name, domain } = req.body as { name?: string; domain?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const storage = await getStorage();
    assertUnderLimit(req.auth?.planTier, 'clientSites', (await storage.listSites()).length);
    const site = await storage.createSite(name, domain);
    res.status(201).json(site);
  } catch (err) {
    if (err instanceof LimitExceededError) {
      res.status(err.status).json(err.body);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create site' });
  }
});

router.get('/sites/:siteId', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  // Surface the caller's publish capability so the editor can show Publish vs Submit-for-review.
  res.json({
    ...sanitizeSite(site),
    capabilities: { canPublish: canActorPublish(req.auth, site.meta) },
  });
});

router.patch('/sites/:siteId', requireOwner, async (req, res) => {
  try {
    const storage = await getStorage();
    const meta = await storage.updateSiteMeta(routeParam(req.params.siteId), req.body);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

router.delete('/sites/:siteId', requireOwner, async (req, res) => {
  const storage = await getStorage();
  await storage.deleteSite(routeParam(req.params.siteId));
  res.status(204).send();
});

router.post('/sites/:siteId/password', requireOwner, async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: 'password is required' });
      return;
    }
    const storage = await getStorage();
    await storage.setClientPassword(routeParam(req.params.siteId), hashPassword(password));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to set password' });
  }
});

// ── Pages ──────────────────────────────────────────────────────

router.get('/sites/:siteId/pages', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const pages = await storage.listPages(routeParam(req.params.siteId));
  res.json(pages);
});

router.get('/sites/:siteId/pages/:pageId', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const page = await storage.getPage(routeParam(req.params.siteId), routeParam(req.params.pageId));
  if (!page) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }
  res.json(page);
});

router.post('/sites/:siteId/pages/ingest', siteAuth, requireWorkspaceAdmin, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const result = await ingestUrl(url);
    const storage = await getStorage();
    const siteId = routeParam(req.params.siteId);
    const existingPages = await storage.listPages(siteId);
    const page = await storage.upsertPage(siteId, {
      id: nanoid(10),
      path: result.pagePath,
      title: result.title,
      sourceUrl: result.sourceUrl,
      content: deriveNamedElements(result.content, existingPages.length + 1),
    });
    res.status(201).json(page);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Ingest failed' });
  }
});

/** One page of an apply-generated request body. */
export interface ApplyGeneratedPageInput {
  path: string;
  title: string;
  content: PageContent;
}

export type PrepareGeneratedPagesResult<T extends { path: string; content: PageContent }> =
  | { ok: false; status: 400 | 409 | 422; error: string; errors: string[] }
  | { ok: true; newPages: ApplyGeneratedPageInput[]; existingUpdates: T[] };

/**
 * Chunk 9 (Phase 7a) — validate-then-prepare for POST /pages/apply-generated.
 * All-or-nothing: a malformed generation must never be persisted, so one bad
 * page rejects the whole batch (422) with per-page Guardian errors. Generated
 * pages carry authoritative containers/namedElements (source:'generated'), so
 * this must NOT deriveNamedElements. Append-only (decision #7): a path that
 * already exists on the site is a 409 conflict — which also makes a retried
 * apply safe — and replace semantics are Phase 8 / Chunk 10.
 *
 * Element -pN ids follow position in site.pages, which storage keeps sorted by
 * path — NOT insertion order — so the whole combined set (existing + new) is
 * reconciled in its final sorted order. Existing pages whose position shifts
 * (e.g. a new "/" sorting ahead of "/blog") come back in `existingUpdates`
 * and must be re-saved by the caller. Pure — unit-tested directly.
 */
export function prepareGeneratedPages<T extends { path: string; content: PageContent }>(
  input: unknown,
  existingPages: T[]
): PrepareGeneratedPagesResult<T> {
  const bad = (status: 400 | 409, error: string): PrepareGeneratedPagesResult<T> => ({ ok: false, status, error, errors: [] });

  if (!Array.isArray(input) || input.length === 0) {
    return bad(400, 'pages must be a non-empty array');
  }
  const pages: ApplyGeneratedPageInput[] = [];
  const existingPaths = new Set(existingPages.map((p) => p.path));
  const seenPaths = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const p = input[i] as Partial<ApplyGeneratedPageInput> | null;
    if (!p || typeof p !== 'object') return bad(400, `pages[${i}] must be an object`);
    if (typeof p.path !== 'string' || !p.path.startsWith('/')) {
      return bad(400, `pages[${i}].path must be a string starting with "/"`);
    }
    if (typeof p.title !== 'string' || p.title.trim() === '') {
      return bad(400, `pages[${i}].title must be a non-empty string`);
    }
    if (!p.content || typeof p.content !== 'object' || Array.isArray(p.content)) {
      return bad(400, `pages[${i}].content is required`);
    }
    if (seenPaths.has(p.path)) return bad(400, `pages[${i}].path "${p.path}" appears more than once`);
    if (existingPaths.has(p.path)) {
      return bad(409, `a page at "${p.path}" already exists on this site — apply-generated only adds new pages`);
    }
    seenPaths.add(p.path);
    pages.push({ path: p.path, title: p.title, content: p.content });
  }

  const guardianErrors: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const result = validateGeneratedPage(pages[i].content);
    if (!result.ok) {
      guardianErrors.push(...result.errors.map((e) => `pages[${i}] (${pages[i].path}): ${e}`));
    }
  }
  if (guardianErrors.length > 0) {
    return { ok: false, status: 422, error: 'Generated pages failed validation', errors: guardianErrors };
  }

  type Entry = { content: PageContent; existing?: T; added?: ApplyGeneratedPageInput };
  const combined: Entry[] = [
    ...existingPages.map((p): Entry => ({ content: p.content, existing: p })),
    ...pages.map((p): Entry => ({ content: p.content, added: p })),
  ].sort((a, b) => (a.existing ?? a.added)!.path.localeCompare((b.existing ?? b.added)!.path));

  const reconciled = reconcilePageNumbers(combined).pages;
  const newPages: ApplyGeneratedPageInput[] = [];
  const existingUpdates: T[] = [];
  for (let i = 0; i < reconciled.length; i++) {
    const entry = reconciled[i];
    if (entry.added) {
      newPages.push({ ...entry.added, content: entry.content });
    } else if (entry !== combined[i]) {
      // reconcilePageNumbers returns untouched pages by reference — a new object
      // means this existing page's elements were renumbered and must be re-saved.
      existingUpdates.push({ ...entry.existing!, content: entry.content });
    }
  }
  // Preserve request order in the response (sorting was only for numbering).
  newPages.sort((a, b) => pages.findIndex((p) => p.path === a.path) - pages.findIndex((p) => p.path === b.path));
  return { ok: true, newPages, existingUpdates };
}

/**
 * POST /sites/:siteId/pages/apply-generated
 * Chunk 9: persist the chosen direction's pages from POST /sites/:siteId/generate
 * (which is return-only). Body: { pages: [{ path, title, content }] }.
 */
router.post('/sites/:siteId/pages/apply-generated', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const prepared = prepareGeneratedPages((req.body as { pages?: unknown })?.pages, site.pages);
    if (!prepared.ok) {
      res.status(prepared.status).json({ error: prepared.error, ...(prepared.errors.length ? { guardianErrors: prepared.errors } : {}) });
      return;
    }

    const saved = [];
    for (const page of prepared.newPages) {
      saved.push(
        await storage.upsertPage(siteId, {
          id: nanoid(10),
          path: page.path,
          title: page.title,
          content: page.content,
        })
      );
    }
    // Existing pages whose -pN position shifted because a new page sorts ahead of them.
    for (const page of prepared.existingUpdates) {
      await storage.upsertPage(siteId, { ...page, updatedAt: undefined });
    }
    res.status(201).json({ pages: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Apply failed' });
  }
});

router.patch('/sites/:siteId/pages/:pageId', siteAuth, async (req, res) => {
  try {
    const { changes } = req.body as { changes?: SlotChange[] };
    if (!changes?.length) {
      res.status(400).json({ error: 'changes array is required' });
      return;
    }
    const storage = await getStorage();
    const page = await storage.getPage(routeParam(req.params.siteId), routeParam(req.params.pageId));
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const result = validateChanges(page.content, changes);
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }

    const updatedContent = mergeValidatedSlots(page.content, result.applied!);
    const saved = await storage.upsertPage(routeParam(req.params.siteId), {
      ...page,
      content: updatedContent,
    });

    const guide = await getStyleGuideStore().then((s) => s.get(routeParam(req.params.siteId)));
    res.json({ page: saved, html: renderPage(updatedContent, guide ?? undefined) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

router.get('/sites/:siteId/pages/:pageId/preview', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const siteId = routeParam(req.params.siteId);
  const page = await storage.getPage(siteId, routeParam(req.params.pageId));
  if (!page) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }
  const guide = await getStyleGuideStore().then((s) => s.get(siteId));
  res.type('html').send(renderPage(page.content, guide ?? undefined));
});

router.delete('/sites/:siteId/pages/:pageId', requireOwner, async (req, res) => {
  const storage = await getStorage();
  await storage.deletePage(routeParam(req.params.siteId), routeParam(req.params.pageId));
  res.status(204).send();
});

// ── Media (read-only — WordPress import assets) ────────────────

router.get('/sites/:siteId/media', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  const assets = await storage.listMediaAssets(routeParam(req.params.siteId));
  res.json(
    assets.map(({ siteId: _, ...asset }) => ({
      id: asset.id,
      filename: asset.filename,
      publicPath: asset.publicPath,
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      sourceUrl: asset.sourceUrl,
      wpPostId: asset.wpPostId,
      createdAt: asset.createdAt,
    }))
  );
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image uploads are allowed'));
  },
});

router.post('/sites/:siteId/media/upload', siteAuth, upload.single('file'), async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    if (!req.file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const ext = extname(req.file.originalname) || '.png';
    const filename = `${nanoid(10)}${ext}`;
    const relativePath = `uploads/${filename}`;
    const publicDir = join(storage.getSitePublicDir(siteId), 'wp-content', 'uploads');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, filename), req.file.buffer);

    const asset = await storage.upsertMediaAsset(siteId, {
      id: nanoid(12),
      filename,
      publicPath: `/media/${siteId}/wp-content/uploads/${filename}`,
      relativePath,
      mimeType: req.file.mimetype,
    });

    res.status(201).json({
      id: asset.id,
      filename: asset.filename,
      publicPath: asset.publicPath,
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

// ── Versions ───────────────────────────────────────────────────

router.get('/sites/:siteId/versions', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const versions = await storage.listVersions(routeParam(req.params.siteId));
  res.json(versions);
});

router.post('/sites/:siteId/versions', siteAuth, async (req, res) => {
  try {
    const { label } = req.body as { label?: string };
    const storage = await getStorage();
    const version = await storage.createVersion(
      routeParam(req.params.siteId),
      label ?? `Snapshot ${new Date().toISOString()}`
    );
    res.status(201).json(version);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Version create failed' });
  }
});

router.post('/sites/:siteId/versions/:versionId/restore', siteAuth, async (req, res) => {
  try {
    const storage = await getStorage();
    const site = await storage.restoreVersion(routeParam(req.params.siteId), routeParam(req.params.versionId));
    res.json(site);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Restore failed' });
  }
});

export default router;
