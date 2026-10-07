import { getStorage } from '../storage/filesystem.js';
import { getBlogSiloStore } from '../storage/blog-silo.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { hasFeature } from '../auth/entitlements.js';
import { renderBlogBundle } from '../blog/render.js';
import { resolveVercelCredentials } from '../integrations/resolve.js';
import {
  savePublishBundle,
  deployToVercel,
  updatePublishRecord,
  listPublishes,
  resolveRollbackVersionId,
  type PublishRecord,
} from './index.js';
import type { PageContent } from '../content/types.js';

export interface PublishedSnapshot {
  record: PublishRecord;
  /** pageId -> the exact PageContent that was live as of this publish */
  pages: Record<string, PageContent>;
}

/**
 * The latest publish's exact content snapshot — what the outside world should
 * see. Content comes from the pre-publish SiteVersion linked to the newest
 * publish record, never the working copy, so unreviewed edits don't leak to
 * consumers like the WordPress connector. Null when the site has never been
 * published or the snapshot can't be resolved (treated as unpublished).
 */
export async function getPublishedSnapshot(siteId: string): Promise<PublishedSnapshot | null> {
  const [latest] = await listPublishes(siteId); // newest-first
  if (!latest) return null;

  const storage = await getStorage();
  const versions = await storage.listVersions(siteId);
  const resolved = resolveRollbackVersionId(latest, versions);
  if (!resolved.ok) return null;

  const version = versions.find((v) => v.id === resolved.versionId);
  if (!version) return null;
  return { record: latest, pages: version.pages };
}

/** Error carrying an HTTP status so route handlers can map it cleanly. */
export class PublishError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface PublishResult {
  record: PublishRecord;
  deploymentUrl?: string;
  vercelDeploymentId?: string;
  localFiles: string[];
}

/**
 * Render the site's current content into an immutable static snapshot, link a
 * pre-publish content version for rollback, optionally deploy to Vercel, and clear
 * any outstanding review request. Shared by POST /publish and review approval.
 */
export async function publishSite(
  siteId: string,
  opts: { label?: string; deploy?: boolean } = {}
): Promise<PublishResult> {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  if (!site) throw new PublishError('Site not found', 404);
  if (site.pages.length === 0) throw new PublishError('No pages to publish', 400);

  const siloStore = await getBlogSiloStore();
  const styleStore = await getStyleGuideStore();
  const silos = await siloStore.listSilos(siteId);
  const guide = await styleStore.get(siteId);
  const siteUrl = site.meta.domain
    ? `https://${site.meta.domain}`
    : process.env.APP_URL ?? 'https://example.com';
  const blogFiles = renderBlogBundle(silos, { siteUrl, guide });

  // Tier watermark: a never-bootstrapped instance (no workspace) publishes like free.
  const workspace = await (await getWorkspaceUsersStore()).getWorkspace();
  const watermark = !hasFeature(workspace?.planTier ?? 'free', 'removeWatermark');

  const bundle = await savePublishBundle(
    siteId,
    site.pages,
    opts.label ?? `Publish ${new Date().toISOString()}`,
    blogFiles,
    guide ?? undefined,
    watermark
  );

  const prePublishVersion = await storage.createVersion(siteId, `Pre-publish ${bundle.record.id}`, {
    publishId: bundle.record.id,
  });
  bundle.record.prePublishVersionId = prePublishVersion.id;
  await updatePublishRecord(bundle.record);

  let deploymentUrl: string | undefined;
  let vercelDeploymentId: string | undefined;

  const vercel = await resolveVercelCredentials();
  if (opts.deploy !== false && vercel.token) {
    const result = await deployToVercel(bundle.record, bundle.files, {
      token: vercel.token,
      projectName: site.meta.domain?.replace(/\./g, '-') ?? `freshpress-${site.meta.id}`,
      teamId: vercel.teamId ?? undefined,
    });
    deploymentUrl = result.url;
    vercelDeploymentId = result.deploymentId;
    bundle.record.deploymentUrl = deploymentUrl;
    bundle.record.vercelDeploymentId = vercelDeploymentId;
    await updatePublishRecord(bundle.record);
  }

  // Publishing resolves any outstanding review request.
  if (site.meta.review) {
    await storage.updateSiteMeta(siteId, { review: undefined });
  }

  return {
    record: bundle.record,
    deploymentUrl,
    vercelDeploymentId,
    localFiles: Object.keys(bundle.files),
  };
}
