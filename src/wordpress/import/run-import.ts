import { nanoid } from 'nanoid';
import { ingestHtml } from '../../ingest/index.js';
import type { StorageAdapter } from '../../storage/types.js';
import type { ArticleStatus, ImportJob } from '../../content/blog-types.js';
import {
  parseWxr,
  sortCategoriesParentFirst,
  getMetaValue,
  type ParsedWxr,
  type WxrItem,
} from './parse-wxr.js';
import { MediaMigrator, rewriteContentUrls } from './media-migrator.js';

export interface RunImportOptions {
  storage: StorageAdapter;
  parsed: ParsedWxr;
  sourceBaseUrl?: string;
  uploadsZipPath?: string;
  sitePageSlugs?: string[];
  importDrafts?: boolean;
  onProgress?: (job: ImportJob) => void;
}

export interface RunImportResult {
  siteId: string;
  job: ImportJob;
}

function wpDateToIso(date?: string): string | undefined {
  if (!date) return undefined;
  const normalized = date.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function isImportableStatus(status: string, importDrafts: boolean): boolean {
  if (status === 'publish') return true;
  if (importDrafts && ['draft', 'private', 'pending', 'future'].includes(status)) return true;
  return false;
}

async function updateJob(
  storage: StorageAdapter,
  job: ImportJob,
  patch: Partial<ImportJob>,
  onProgress?: (job: ImportJob) => void
): Promise<ImportJob> {
  const updated = await storage.updateImportJob(job.siteId, { ...job, ...patch });
  onProgress?.(updated);
  return updated;
}

/** Run full WordPress import — creates site and populates blog content */
export async function runWordPressImport(opts: RunImportOptions): Promise<RunImportResult> {
  const { storage, parsed, sourceBaseUrl, uploadsZipPath, sitePageSlugs = [], importDrafts = false } = opts;

  const domain = sourceBaseUrl ?? parsed.siteUrl;
  let hostname: string | undefined;
  if (domain) {
    try {
      hostname = new URL(domain).hostname;
    } catch {
      hostname = undefined;
    }
  }

  const site = await storage.createSite(parsed.siteName, hostname);
  const siteId = site.meta.id;

  if (sourceBaseUrl ?? parsed.siteUrl) {
    await storage.updateSiteMeta(siteId, { sourceBaseUrl: sourceBaseUrl ?? parsed.siteUrl });
  }

  let job = await storage.createImportJob(siteId);
  job = await updateJob(storage, job, { status: 'running', currentStep: 'authors', progress: 5 }, opts.onProgress);

  const authorByLogin = new Map<string, string>();
  const authorByWpId = new Map<number, string>();
  const categoryBySlug = new Map<string, string>();
  const categoryByWpId = new Map<number, string>();
  const tagBySlug = new Map<string, string>();
  const tagByWpId = new Map<number, string>();
  const mediaByWpPostId = new Map<number, string>();
  const urlMap = new Map<string, string>();
  const articleByWpPostId = new Map<number, string>();
  const commentByWpId = new Map<number, string>();
  const usedSlugs = new Set<string>();

  const migrator = new MediaMigrator({
    siteId,
    publicDir: storage.getSitePublicDir(siteId),
    sourceBaseUrl: sourceBaseUrl ?? parsed.siteUrl,
    uploadsZipPath,
  });

  const errors: string[] = [];
  let mediaFailed = 0;

  // Step 2: Authors
  for (const a of parsed.authors) {
    const id = nanoid(10);
    await storage.upsertAuthor(siteId, {
      id,
      wpAuthorId: a.wpAuthorId || undefined,
      login: a.login,
      displayName: a.displayName,
      email: a.email,
    });
    authorByLogin.set(a.login, id);
    if (a.wpAuthorId) authorByWpId.set(a.wpAuthorId, id);
  }
  job = await updateJob(
    storage,
    job,
    { currentStep: 'categories', progress: 15, stats: { ...job.stats, authors: parsed.authors.length } },
    opts.onProgress
  );

  // Step 3: Categories (parent-first)
  const sortedCats = sortCategoriesParentFirst(parsed.categories);
  const catBySlugMeta = new Map(sortedCats.map((c) => [c.slug, c]));

  for (const c of sortedCats) {
    const id = nanoid(10);
    const parentId = c.parentSlug ? categoryBySlug.get(c.parentSlug) : undefined;

    const pathSlugs: string[] = [];
    let curSlug: string | undefined = c.slug;
    while (curSlug) {
      pathSlugs.unshift(curSlug);
      const cur = catBySlugMeta.get(curSlug);
      curSlug = cur?.parentSlug;
    }

    await storage.upsertCategory(siteId, {
      id,
      wpTermId: c.wpTermId || undefined,
      name: c.name,
      slug: c.slug,
      parentId,
      path: pathSlugs,
    });
    categoryBySlug.set(c.slug, id);
    if (c.wpTermId) categoryByWpId.set(c.wpTermId, id);
  }
  job = await updateJob(
    storage,
    job,
    { currentStep: 'tags', progress: 25, stats: { ...job.stats, categories: parsed.categories.length } },
    opts.onProgress
  );

  // Step 4: Tags
  for (const t of parsed.tags) {
    const id = nanoid(10);
    await storage.upsertTag(siteId, {
      id,
      wpTermId: t.wpTermId || undefined,
      name: t.name,
      slug: t.slug,
    });
    tagBySlug.set(t.slug, id);
    if (t.wpTermId) tagByWpId.set(t.wpTermId, id);
  }
  job = await updateJob(
    storage,
    job,
    { currentStep: 'attachments', progress: 35, stats: { ...job.stats, tags: parsed.tags.length } },
    opts.onProgress
  );

  // Step 5: Attachments
  const attachments = parsed.items.filter((i) => i.postType === 'attachment');
  for (const item of attachments) {
    const attachedFile = getMetaValue(item, '_wp_attached_file');
    const url = item.attachmentUrl || item.link;
    const result = await migrator.migrateFromUrl(url, attachedFile);
    if (result.failed) {
      mediaFailed++;
      errors.push(`Attachment failed: ${item.title} — ${result.error}`);
      continue;
    }
    const id = nanoid(10);
    await storage.upsertMediaAsset(siteId, {
      id,
      wpPostId: item.wpPostId || undefined,
      filename: result.relativePath.split('/').pop() ?? item.slug,
      publicPath: result.publicPath,
      relativePath: result.relativePath,
      sourceUrl: result.sourceUrl,
    });
    mediaByWpPostId.set(item.wpPostId, id);
    if (result.sourceUrl) urlMap.set(result.sourceUrl, result.publicPath);
    if (url && url !== result.sourceUrl) urlMap.set(url, result.publicPath);
  }
  job = await updateJob(
    storage,
    job,
    {
      currentStep: 'avatars',
      progress: 50,
      stats: { ...job.stats, attachments: attachments.length - mediaFailed, mediaFailed },
    },
    opts.onProgress
  );

  // Step 6: Avatars — attempt fetch for each author from common paths
  for (const a of parsed.authors) {
    const authorId = authorByLogin.get(a.login);
    if (!authorId || !a.wpAuthorId) continue;
    const avatarPaths = [`avatars/${a.wpAuthorId}.jpg`, `avatars/${a.wpAuthorId}.png`];
    for (const rel of avatarPaths) {
      const url = `${(sourceBaseUrl ?? parsed.siteUrl ?? '').replace(/\/$/, '')}/wp-content/uploads/${rel}`;
      try {
        const result = await migrator.migrateFromUrl(url, rel);
        if (!result.failed) {
          await storage.upsertAuthor(siteId, {
            id: authorId,
            wpAuthorId: a.wpAuthorId,
            login: a.login,
            displayName: a.displayName,
            email: a.email,
            avatarPath: result.publicPath,
          });
          break;
        }
      } catch {
        // try next extension
      }
    }
  }
  job = await updateJob(storage, job, { currentStep: 'articles', progress: 60 }, opts.onProgress);

  // Step 7: Articles (posts + pages)
  const contentItems = parsed.items.filter(
    (i) => (i.postType === 'post' || i.postType === 'page') && isImportableStatus(i.status, importDrafts)
  );

  for (const item of contentItems) {
    let slug = item.slug || item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (usedSlugs.has(slug)) {
      let n = 2;
      while (usedSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);

    const authorId = item.creator ? authorByLogin.get(item.creator) : undefined;
    const categoryIds = item.categories
      .filter((c) => c.domain === 'category')
      .map((c) => categoryBySlug.get(c.slug))
      .filter((id): id is string => !!id);
    const tagIds = item.categories
      .filter((c) => c.domain === 'post_tag')
      .map((c) => tagBySlug.get(c.slug))
      .filter((id): id is string => !!id);

    const thumbId = getMetaValue(item, '_thumbnail_id');
    const featuredMediaId = thumbId ? mediaByWpPostId.get(Number(thumbId)) : undefined;

    let contentHtml = item.content ?? '';
    contentHtml = rewriteContentUrls(contentHtml, urlMap);

    const id = nanoid(10);
    await storage.upsertArticle(siteId, {
      id,
      wpPostId: item.wpPostId || undefined,
      type: item.postType as 'post' | 'page',
      title: item.title,
      slug,
      contentHtml,
      excerpt: item.excerpt || undefined,
      authorId,
      categoryIds,
      tagIds,
      featuredMediaId,
      status: item.status as ArticleStatus,
      publishedAt: wpDateToIso(item.postDate),
    });
    articleByWpPostId.set(item.wpPostId, id);
  }
  job = await updateJob(
    storage,
    job,
    { currentStep: 'comments', progress: 75, stats: { ...job.stats, articles: contentItems.length } },
    opts.onProgress
  );

  // Step 8: Comments (two passes for threading)
  let commentCount = 0;
  const pendingComments: Array<{ item: WxrItem; comment: WxrItem['comments'][0] }> = [];
  for (const item of parsed.items) {
    for (const c of item.comments) {
      pendingComments.push({ item, comment: c });
    }
  }

  // First pass: top-level and store IDs
  for (const { item, comment: c } of pendingComments.filter((p) => p.comment.parentId === 0)) {
    const articleId = articleByWpPostId.get(item.wpPostId);
    if (!articleId) continue;
    const id = nanoid(10);
    await storage.upsertComment(siteId, {
      id,
      wpCommentId: c.wpCommentId || undefined,
      articleId,
      authorName: c.author,
      authorEmail: c.authorEmail,
      authorUrl: c.authorUrl,
      content: c.content,
      status: c.approved === '1' ? 'approved' : 'pending',
      createdAt: wpDateToIso(c.date) ?? new Date().toISOString(),
    });
    if (c.wpCommentId) commentByWpId.set(c.wpCommentId, id);
    commentCount++;
  }

  // Second pass: replies
  for (const { item, comment: c } of pendingComments.filter((p) => p.comment.parentId !== 0)) {
    const articleId = articleByWpPostId.get(item.wpPostId);
    const parentId = commentByWpId.get(c.parentId);
    if (!articleId) continue;
    const id = nanoid(10);
    await storage.upsertComment(siteId, {
      id,
      wpCommentId: c.wpCommentId || undefined,
      articleId,
      parentId,
      authorName: c.author,
      authorEmail: c.authorEmail,
      authorUrl: c.authorUrl,
      content: c.content,
      status: c.approved === '1' ? 'approved' : 'pending',
      createdAt: wpDateToIso(c.date) ?? new Date().toISOString(),
    });
    if (c.wpCommentId) commentByWpId.set(c.wpCommentId, id);
    commentCount++;
  }
  job = await updateJob(
    storage,
    job,
    { currentStep: 'sitePages', progress: 85, stats: { ...job.stats, comments: commentCount } },
    opts.onProgress
  );

  // Step 9: Selected WP pages → SitePages
  const slugSet = new Set(sitePageSlugs);
  let sitePageCount = 0;
  for (const item of parsed.items.filter((i) => i.postType === 'page' && slugSet.has(i.slug))) {
    const html = item.content ?? '';
    const wrapped = `<!DOCTYPE html><html><head><title>${item.title}</title></head><body>${html}</body></html>`;
    const sourceUrl = item.link || `${sourceBaseUrl ?? parsed.siteUrl ?? 'https://import.local'}/${item.slug}`;
    const ingested = ingestHtml(sourceUrl, wrapped);

    // Rewrite image URLs in slots
    for (const slot of Object.values(ingested.content.slots)) {
      if (slot.type === 'image' && slot.value) {
        const rewritten = urlMap.get(slot.value);
        if (rewritten) slot.value = rewritten;
      }
    }

    const pagePath = item.slug === 'home' || item.slug === 'front-page' ? '/' : `/${item.slug}`;
    await storage.upsertPage(siteId, {
      id: nanoid(10),
      path: pagePath,
      title: item.title,
      sourceUrl: item.link,
      content: ingested.content,
    });
    sitePageCount++;
  }
  job = await updateJob(
    storage,
    job,
    {
      status: 'completed',
      progress: 100,
      currentStep: 'done',
      errors,
      stats: {
        ...job.stats,
        sitePages: sitePageCount,
        mediaFailed,
      },
    },
    opts.onProgress
  );

  return { siteId, job };
}

/** Parse XML string and run import */
export async function importWordPressXml(
  xml: string,
  opts: Omit<RunImportOptions, 'parsed' | 'storage'> & { storage: StorageAdapter }
): Promise<RunImportResult> {
  const parsed = parseWxr(xml);
  return runWordPressImport({ ...opts, parsed });
}

export { parseWxr, buildImportPreview } from './parse-wxr.js';
export type { ParsedWxr } from './parse-wxr.js';
