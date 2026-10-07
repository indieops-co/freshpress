import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type {
  StorageAdapter,
  Site,
  SiteMeta,
  SitePage,
  SiteVersion,
  FormSubmission,
  Subscriber,
} from './types.js';
import type {
  Author,
  Category,
  Tag,
  MediaAsset,
  Article,
  Comment,
  ImportJob,
} from '../content/blog-types.js';

const DEFAULT_DATA_DIR = join(process.cwd(), 'data');

export class FileSystemStorage implements StorageAdapter {
  private sitesDir: string;

  constructor(dataDir?: string) {
    const root = dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
    this.sitesDir = join(root, 'sites');
  }

  private siteDir(siteId: string) {
    return join(this.sitesDir, siteId);
  }

  private metaPath(siteId: string) {
    return join(this.siteDir(siteId), 'meta.json');
  }

  private pagesDir(siteId: string) {
    return join(this.siteDir(siteId), 'pages');
  }

  private versionsDir(siteId: string) {
    return join(this.siteDir(siteId), 'versions');
  }

  private submissionsDir(siteId: string) {
    return join(this.siteDir(siteId), 'submissions');
  }

  private subscribersDir(siteId: string) {
    return join(this.siteDir(siteId), 'subscribers');
  }

  private blogDir(siteId: string, entity: string) {
    return join(this.siteDir(siteId), 'blog', entity);
  }

  private importsDir(siteId: string) {
    return join(this.siteDir(siteId), 'imports');
  }

  getSitePublicDir(siteId: string): string {
    return join(this.siteDir(siteId), 'public');
  }

  async listSites(): Promise<SiteMeta[]> {
    await mkdir(this.sitesDir, { recursive: true });
    const dirs = await readdir(this.sitesDir, { withFileTypes: true });
    const sites: SiteMeta[] = [];

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const meta = await this.readJson<SiteMeta>(this.metaPath(dir.name));
        sites.push(meta);
      } catch {
        // skip corrupt entries
      }
    }

    return sites.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSite(siteId: string): Promise<Site | null> {
    try {
      const meta = await this.readJson<SiteMeta>(this.metaPath(siteId));
      const pages = await this.listPages(siteId);
      return { meta, pages };
    } catch {
      return null;
    }
  }

  async createSite(name: string, domain?: string): Promise<Site> {
    const id = nanoid(12);
    const now = new Date().toISOString();
    const meta: SiteMeta = { id, name, domain, createdAt: now, updatedAt: now };

    await mkdir(this.pagesDir(id), { recursive: true });
    await mkdir(this.versionsDir(id), { recursive: true });
    await mkdir(join(this.siteDir(id), 'public', 'wp-content', 'uploads'), { recursive: true });
    await this.writeJson(this.metaPath(id), meta);

    return { meta, pages: [] };
  }

  async updateSiteMeta(
    siteId: string,
    patch: Partial<
      Pick<
        SiteMeta,
        'name' | 'domain' | 'email' | 'sourceBaseUrl' | 'styleGuideId' | 'emailBrandDefaults' | 'inboundEmail' | 'signupWebhooks' | 'discoveredElementTypes' | 'clientCanPublish' | 'review'
      >
    >
  ): Promise<SiteMeta> {
    const meta = await this.readJson<SiteMeta>(this.metaPath(siteId));
    const updated: SiteMeta = {
      ...meta,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.writeJson(this.metaPath(siteId), updated);
    return updated;
  }

  async setClientPassword(siteId: string, passwordHash: string): Promise<void> {
    const meta = await this.readJson<SiteMeta>(this.metaPath(siteId));
    meta.clientPasswordHash = passwordHash;
    meta.updatedAt = new Date().toISOString();
    await this.writeJson(this.metaPath(siteId), meta);
  }

  async deleteSite(siteId: string): Promise<void> {
    await rm(this.siteDir(siteId), { recursive: true, force: true });
  }

  async listPages(siteId: string): Promise<SitePage[]> {
    try {
      const files = await readdir(this.pagesDir(siteId));
      const pages: SitePage[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        pages.push(await this.readJson<SitePage>(join(this.pagesDir(siteId), file)));
      }
      return pages.sort((a, b) => a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  }

  async getPage(siteId: string, pageId: string): Promise<SitePage | null> {
    try {
      return await this.readJson<SitePage>(join(this.pagesDir(siteId), `${pageId}.json`));
    } catch {
      return null;
    }
  }

  async upsertPage(
    siteId: string,
    page: Omit<SitePage, 'updatedAt'> & { updatedAt?: string }
  ): Promise<SitePage> {
    const saved: SitePage = {
      ...page,
      updatedAt: page.updatedAt ?? new Date().toISOString(),
    };
    await mkdir(this.pagesDir(siteId), { recursive: true });
    await this.writeJson(join(this.pagesDir(siteId), `${page.id}.json`), saved);

    const meta = await this.readJson<SiteMeta>(this.metaPath(siteId));
    meta.updatedAt = saved.updatedAt;
    await this.writeJson(this.metaPath(siteId), meta);

    return saved;
  }

  async deletePage(siteId: string, pageId: string): Promise<void> {
    await rm(join(this.pagesDir(siteId), `${pageId}.json`), { force: true });
  }

  async listVersions(siteId: string): Promise<SiteVersion[]> {
    try {
      const files = await readdir(this.versionsDir(siteId));
      const versions: SiteVersion[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        versions.push(await this.readJson<SiteVersion>(join(this.versionsDir(siteId), file)));
      }
      return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async getVersion(siteId: string, versionId: string): Promise<SiteVersion | null> {
    try {
      return await this.readJson<SiteVersion>(join(this.versionsDir(siteId), `${versionId}.json`));
    } catch {
      return null;
    }
  }

  async createVersion(siteId: string, label: string, options?: { publishId?: string }): Promise<SiteVersion> {
    const pages = await this.listPages(siteId);
    const version: SiteVersion = {
      id: nanoid(10),
      label,
      createdAt: new Date().toISOString(),
      ...(options?.publishId ? { publishId: options.publishId } : {}),
      pages: Object.fromEntries(pages.map((p) => [p.id, p.content])),
    };
    await this.writeJson(join(this.versionsDir(siteId), `${version.id}.json`), version);
    return version;
  }

  async restoreVersion(siteId: string, versionId: string): Promise<Site> {
    const version = await this.getVersion(siteId, versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);

    const existingPages = await this.listPages(siteId);
    const pageMap = new Map(existingPages.map((p) => [p.id, p]));

    for (const [pageId, content] of Object.entries(version.pages)) {
      const existing = pageMap.get(pageId);
      if (existing) {
        await this.upsertPage(siteId, { ...existing, content });
      }
    }

    return (await this.getSite(siteId))!;
  }

  async listSubmissions(siteId: string): Promise<FormSubmission[]> {
    try {
      const files = await readdir(this.submissionsDir(siteId));
      const submissions: FormSubmission[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        submissions.push(await this.readJson<FormSubmission>(join(this.submissionsDir(siteId), file)));
      }
      return submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async addSubmission(
    siteId: string,
    submission: Omit<FormSubmission, 'id' | 'siteId' | 'createdAt'>
  ): Promise<FormSubmission> {
    const saved: FormSubmission = {
      ...submission,
      id: nanoid(10),
      siteId,
      createdAt: new Date().toISOString(),
    };
    await mkdir(this.submissionsDir(siteId), { recursive: true });
    await this.writeJson(join(this.submissionsDir(siteId), `${saved.id}.json`), saved);
    return saved;
  }

  async getSubmission(siteId: string, submissionId: string): Promise<FormSubmission | null> {
    try {
      return await this.readJson<FormSubmission>(join(this.submissionsDir(siteId), `${submissionId}.json`));
    } catch {
      return null;
    }
  }

  async listSubscribers(siteId: string): Promise<Subscriber[]> {
    try {
      const files = await readdir(this.subscribersDir(siteId));
      const subscribers: Subscriber[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        subscribers.push(await this.readJson<Subscriber>(join(this.subscribersDir(siteId), file)));
      }
      return subscribers.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async findSubscriberByEmail(siteId: string, email: string): Promise<Subscriber | null> {
    const needle = email.trim().toLowerCase();
    const subscribers = await this.listSubscribers(siteId);
    return subscribers.find((s) => s.email === needle) ?? null;
  }

  async findSubscriberByToken(
    siteId: string,
    field: 'confirmToken' | 'unsubscribeToken',
    token: string
  ): Promise<Subscriber | null> {
    if (!token) return null;
    const subscribers = await this.listSubscribers(siteId);
    return subscribers.find((s) => s[field] === token) ?? null;
  }

  async saveSubscriber(siteId: string, subscriber: Subscriber): Promise<Subscriber> {
    await mkdir(this.subscribersDir(siteId), { recursive: true });
    await this.writeJson(join(this.subscribersDir(siteId), `${subscriber.id}.json`), subscriber);
    return subscriber;
  }

  async upsertAuthor(
    siteId: string,
    author: Omit<Author, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Author> {
    const saved: Author = {
      ...author,
      siteId,
      createdAt: author.createdAt ?? new Date().toISOString(),
    };
    await mkdir(this.blogDir(siteId, 'authors'), { recursive: true });
    await this.writeJson(join(this.blogDir(siteId, 'authors'), `${saved.id}.json`), saved);
    return saved;
  }

  async listAuthors(siteId: string): Promise<Author[]> {
    return this.listBlogEntities<Author>(siteId, 'authors');
  }

  async upsertCategory(
    siteId: string,
    category: Omit<Category, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Category> {
    const saved: Category = {
      ...category,
      siteId,
      createdAt: category.createdAt ?? new Date().toISOString(),
    };
    await mkdir(this.blogDir(siteId, 'categories'), { recursive: true });
    await this.writeJson(join(this.blogDir(siteId, 'categories'), `${saved.id}.json`), saved);
    return saved;
  }

  async listCategories(siteId: string): Promise<Category[]> {
    return this.listBlogEntities<Category>(siteId, 'categories');
  }

  async upsertTag(
    siteId: string,
    tag: Omit<Tag, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Tag> {
    const saved: Tag = {
      ...tag,
      siteId,
      createdAt: tag.createdAt ?? new Date().toISOString(),
    };
    await mkdir(this.blogDir(siteId, 'tags'), { recursive: true });
    await this.writeJson(join(this.blogDir(siteId, 'tags'), `${saved.id}.json`), saved);
    return saved;
  }

  async listTags(siteId: string): Promise<Tag[]> {
    return this.listBlogEntities<Tag>(siteId, 'tags');
  }

  async upsertMediaAsset(
    siteId: string,
    asset: Omit<MediaAsset, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<MediaAsset> {
    const saved: MediaAsset = {
      ...asset,
      siteId,
      createdAt: asset.createdAt ?? new Date().toISOString(),
    };
    await mkdir(this.blogDir(siteId, 'media'), { recursive: true });
    await this.writeJson(join(this.blogDir(siteId, 'media'), `${saved.id}.json`), saved);
    return saved;
  }

  async listMediaAssets(siteId: string): Promise<MediaAsset[]> {
    return this.listBlogEntities<MediaAsset>(siteId, 'media');
  }

  async upsertArticle(
    siteId: string,
    article: Omit<Article, 'siteId' | 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }
  ): Promise<Article> {
    const now = new Date().toISOString();
    const saved: Article = {
      ...article,
      siteId,
      createdAt: article.createdAt ?? now,
      updatedAt: article.updatedAt ?? now,
    };
    await mkdir(this.blogDir(siteId, 'articles'), { recursive: true });
    await this.writeJson(join(this.blogDir(siteId, 'articles'), `${saved.id}.json`), saved);
    return saved;
  }

  async listArticles(siteId: string): Promise<Article[]> {
    return this.listBlogEntities<Article>(siteId, 'articles');
  }

  async getArticle(siteId: string, articleId: string): Promise<Article | null> {
    try {
      return await this.readJson<Article>(join(this.blogDir(siteId, 'articles'), `${articleId}.json`));
    } catch {
      return null;
    }
  }

  async upsertComment(
    siteId: string,
    comment: Omit<Comment, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Comment> {
    const saved: Comment = {
      ...comment,
      siteId,
      createdAt: comment.createdAt ?? new Date().toISOString(),
    };
    await mkdir(this.blogDir(siteId, 'comments'), { recursive: true });
    await this.writeJson(join(this.blogDir(siteId, 'comments'), `${saved.id}.json`), saved);
    return saved;
  }

  async listComments(siteId: string): Promise<Comment[]> {
    return this.listBlogEntities<Comment>(siteId, 'comments');
  }

  async createImportJob(siteId: string): Promise<ImportJob> {
    const now = new Date().toISOString();
    const job: ImportJob = {
      id: nanoid(12),
      siteId,
      status: 'pending',
      progress: 0,
      errors: [],
      stats: {
        authors: 0,
        categories: 0,
        tags: 0,
        attachments: 0,
        articles: 0,
        comments: 0,
        sitePages: 0,
        mediaFailed: 0,
      },
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(this.importsDir(siteId), { recursive: true });
    await this.writeJson(join(this.importsDir(siteId), `${job.id}.json`), job);
    return job;
  }

  async getImportJob(siteId: string, jobId: string): Promise<ImportJob | null> {
    try {
      return await this.readJson<ImportJob>(join(this.importsDir(siteId), `${jobId}.json`));
    } catch {
      return null;
    }
  }

  async updateImportJob(siteId: string, job: ImportJob): Promise<ImportJob> {
    const updated = { ...job, updatedAt: new Date().toISOString() };
    await mkdir(this.importsDir(siteId), { recursive: true });
    await this.writeJson(join(this.importsDir(siteId), `${updated.id}.json`), updated);
    return updated;
  }

  private async listBlogEntities<T>(siteId: string, entity: string): Promise<T[]> {
    try {
      const dir = this.blogDir(siteId, entity);
      const files = await readdir(dir);
      const items: T[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        items.push(await this.readJson<T>(join(dir, file)));
      }
      return items;
    } catch {
      return [];
    }
  }

  private async readJson<T>(path: string): Promise<T> {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }
}

let storageInstance: StorageAdapter | null = null;

export async function getStorage(): Promise<StorageAdapter> {
  if (storageInstance) return storageInstance;

  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoStorage } = await import('./mongo.js');
    storageInstance = new MongoStorage(mongoUri);
  } else {
    storageInstance = new FileSystemStorage();
  }

  return storageInstance;
}
