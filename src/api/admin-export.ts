import { Router } from 'express';
import { requireOwner } from '../auth/middleware.js';
import { getStorage } from '../storage/filesystem.js';

const router = Router();

/** Export all sites metadata + page counts for backup (owner only). */
router.get('/admin/export', requireOwner, async (_req, res) => {
  try {
    const storage = await getStorage();
    const sites = await storage.listSites();
    const payload = [];

    for (const meta of sites) {
      const site = await storage.getSite(meta.id);
      payload.push({
        meta: site?.meta,
        pageCount: site?.pages.length ?? 0,
        pages: site?.pages.map((p) => ({ id: p.id, path: p.path, title: p.title, updatedAt: p.updatedAt })),
      });
    }

    res.json({ exportedAt: new Date().toISOString(), sites: payload });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
  }
});

export default router;
