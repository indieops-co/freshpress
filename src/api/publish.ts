import { Router } from 'express';
import { getStorage } from '../storage/filesystem.js';
import {
  listPublishes,
  getPublishBundle,
  resolveRollbackVersionId,
} from '../publish/index.js';
import { publishSite, PublishError } from '../publish/service.js';
import { requireSiteAccess, requireCapability } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';

const router = Router();

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

/** Publish current site pages as immutable static snapshot */
router.post('/sites/:siteId/publish', siteAuth, requireCapability('publish'), async (req, res) => {
  try {
    const { label, deploy } = req.body as { label?: string; deploy?: boolean };
    const result = await publishSite(routeParam(req.params.siteId), { label, deploy });
    res.status(201).json({
      publish: result.record,
      deploymentUrl: result.deploymentUrl,
      vercelDeploymentId: result.vercelDeploymentId,
      localFiles: result.localFiles,
    });
  } catch (err) {
    if (err instanceof PublishError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Publish failed' });
  }
});

router.get('/sites/:siteId/publishes', siteAuth, async (req, res) => {
  const publishes = await listPublishes(routeParam(req.params.siteId));
  res.json(publishes);
});

router.get('/sites/:siteId/publishes/:publishId', siteAuth, async (req, res) => {
  const bundle = await getPublishBundle(routeParam(req.params.siteId), routeParam(req.params.publishId));
  if (!bundle) {
    res.status(404).json({ error: 'Publish not found' });
    return;
  }
  res.json(bundle);
});

/** Serve a published page locally (for preview before DNS) */
router.get('/sites/:siteId/publishes/:publishId/preview/*', siteAuth, async (req, res) => {
  const bundle = await getPublishBundle(routeParam(req.params.siteId), routeParam(req.params.publishId));
  if (!bundle) {
    res.status(404).json({ error: 'Publish not found' });
    return;
  }
  const filePath = req.params[0] || 'index.html';
  const html = bundle.files[filePath] ?? bundle.files['index.html'];
  if (!html) {
    res.status(404).json({ error: 'File not found in bundle' });
    return;
  }
  res.type('html').send(html);
});

/** Roll back site content from a publish snapshot (validated via linked version IDs) */
router.post('/sites/:siteId/publishes/:publishId/rollback', siteAuth, requireCapability('publish'), async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const publishId = routeParam(req.params.publishId);
    const bundle = await getPublishBundle(siteId, publishId);
    if (!bundle) {
      res.status(404).json({ error: 'Publish not found' });
      return;
    }

    const storage = await getStorage();
    const versions = await storage.listVersions(siteId);
    const resolved = resolveRollbackVersionId(bundle.record, versions);
    if (!resolved.ok) {
      res.status(404).json({ error: resolved.error });
      return;
    }

    const site = await storage.restoreVersion(siteId, resolved.versionId);
    res.json({
      ok: true,
      publish: bundle.record,
      versionId: resolved.versionId,
      site,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rollback failed' });
  }
});

export default router;
