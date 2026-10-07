import { Router } from 'express';
import multer from 'multer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { getStorage } from '../storage/filesystem.js';
import { requireOwner } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { parseWxr, buildImportPreview } from '../wordpress/import/parse-wxr.js';
import { importWordPressXml } from '../wordpress/import/run-import.js';

const router = Router();

const upload = multer({
  dest: join(tmpdir(), 'freshpress-import'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/** Preview WXR export before creating site */
router.post(
  '/import/wordpress/preview',
  requireOwner,
  upload.single('wxr'),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'wxr file is required' });
        return;
      }
      const xml = await readFile(req.file.path, 'utf-8');
      await unlink(req.file.path).catch(() => {});
      const parsed = parseWxr(xml);
      const preview = buildImportPreview(parsed);
      res.json(preview);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid WXR file' });
    }
  }
);

/** Create new site from WordPress WXR import */
router.post(
  '/import/wordpress',
  requireOwner,
  upload.fields([
    { name: 'wxr', maxCount: 1 },
    { name: 'uploadsZip', maxCount: 1 },
  ]),
  async (req, res) => {
    const wxrFile = req.files && 'wxr' in req.files ? req.files.wxr?.[0] : undefined;
    const zipFile =
      req.files && 'uploadsZip' in req.files ? req.files.uploadsZip?.[0] : undefined;

    if (!wxrFile) {
      res.status(400).json({ error: 'wxr file is required' });
      return;
    }

    let sitePageSlugs: string[] = [];
    try {
      const raw = req.body.sitePageSlugs;
      if (typeof raw === 'string') sitePageSlugs = JSON.parse(raw) as string[];
      else if (Array.isArray(raw)) sitePageSlugs = raw;
    } catch {
      sitePageSlugs = [];
    }

    const sourceBaseUrl =
      typeof req.body.sourceBaseUrl === 'string' ? req.body.sourceBaseUrl.trim() : undefined;
    const importDrafts = req.body.importDrafts === 'true' || req.body.importDrafts === true;

    try {
      const storage = await getStorage();
      const xml = await readFile(wxrFile.path, 'utf-8');
      await unlink(wxrFile.path).catch(() => {});

      const result = await importWordPressXml(xml, {
        storage,
        sourceBaseUrl,
        uploadsZipPath: zipFile?.path,
        sitePageSlugs,
        importDrafts,
      });

      if (zipFile) await unlink(zipFile.path).catch(() => {});

      res.status(201).json({
        siteId: result.siteId,
        jobId: result.job.id,
        job: result.job,
      });
    } catch (err) {
      if (wxrFile) await unlink(wxrFile.path).catch(() => {});
      if (zipFile) await unlink(zipFile.path).catch(() => {});
      res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  }
);

/** Poll import job status */
router.get('/import/wordpress/:jobId', requireOwner, async (req, res) => {
  try {
    const storage = await getStorage();
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
    if (!siteId) {
      res.status(400).json({ error: 'siteId query param is required' });
      return;
    }
    const job = await storage.getImportJob(siteId, routeParam(req.params.jobId));
    if (!job) {
      res.status(404).json({ error: 'Import job not found' });
      return;
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load job' });
  }
});

/** List imported articles for a site */
router.get('/sites/:siteId/blog/articles', requireOwner, async (req, res) => {
  try {
    const storage = await getStorage();
    const articles = await storage.listArticles(routeParam(req.params.siteId));
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list articles' });
  }
});

export default router;
