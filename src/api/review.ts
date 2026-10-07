import { Router, type Request } from 'express';
import { getStorage } from '../storage/filesystem.js';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { requireSiteAccess, requireCapability } from '../auth/middleware.js';
import { publishSite, PublishError } from '../publish/service.js';
import { notifyReviewSubmitted, notifyReviewResolved } from '../email/review-notify.js';
import { routeParam } from '../util/params.js';
import type { SiteReviewState } from '../storage/types.js';

const router = Router();

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

/** Resolve a human label + notifiable email for whoever is acting. */
async function resolveActor(req: Request): Promise<{ label: string; email: string | null }> {
  const auth = req.auth;
  if (auth?.role === 'admin') {
    if (auth.userId) {
      const store = await getWorkspaceUsersStore();
      const user = await store.getUserById(auth.userId);
      if (user) return { label: user.email, email: user.email };
    }
    return { label: 'An administrator', email: null };
  }
  return { label: 'The site client', email: null };
}

/** A submitter is notifiable on resolution only when we stored an email address. */
function submitterEmail(review?: SiteReviewState): string | null {
  if (review?.submittedBy && review.submittedBy.includes('@')) return review.submittedBy;
  return null;
}

/** Submit current content for review — snapshots it and flags the site pending. */
router.post('/sites/:siteId/submit-review', siteAuth, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { note } = req.body as { note?: string };
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const version = await storage.createVersion(siteId, 'Review submission', {});
    const actor = await resolveActor(req);
    const review: SiteReviewState = {
      status: 'pending',
      versionId: version.id,
      submittedBy: actor.email ?? actor.label,
      submittedAt: new Date().toISOString(),
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
    const meta = await storage.updateSiteMeta(siteId, { review });

    // Best-effort; never blocks the submit.
    await notifyReviewSubmitted(site, { submittedBy: actor.label, note: review.note });

    res.status(201).json({ review: meta.review });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Submit for review failed' });
  }
});

/** Approve a pending review: publish the current content and clear the flag. */
router.post('/sites/:siteId/review/approve', siteAuth, requireCapability('publish'), async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { label, deploy } = req.body as { label?: string; deploy?: boolean };
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const notifyTo = submitterEmail(site.meta.review);

    const result = await publishSite(siteId, { label: label ?? 'Approved review', deploy });

    await notifyReviewResolved(site, { to: notifyTo, outcome: 'published' });

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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Approve failed' });
  }
});

/** Reject a pending review: clear the flag (content stays as-is) and notify the submitter. */
router.post('/sites/:siteId/review/reject', siteAuth, requireCapability('publish'), async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { note } = req.body as { note?: string };
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    if (!site.meta.review) {
      res.status(400).json({ error: 'No review is pending for this site' });
      return;
    }
    const notifyTo = submitterEmail(site.meta.review);

    await storage.updateSiteMeta(siteId, { review: undefined });
    await notifyReviewResolved(site, { to: notifyTo, outcome: 'rejected', note: note?.trim() });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Reject failed' });
  }
});

export default router;
