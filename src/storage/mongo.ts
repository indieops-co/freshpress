import { MongoClient, type Db } from 'mongodb';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
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

/** MongoDB storage — activated when MONGODB_URI is set */
export class MongoStorage implements StorageAdapter {
  private client: MongoClient;
  private dbPromise: Promise<Db>;

  constructor(uri: string) {
    this.client = new MongoClient(uri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    this.dbPromise = this.client.connect().then(() => this.client.db(dbName));
  }

  private async db(): Promise<Db> {
    return this.dbPromise;
  }

  async listSites(): Promise<SiteMeta[]> {
    const db = await this.db();
    return db.collection<SiteMeta>('sites').find().sort({ updatedAt: -1 }).toArray();
  }

  async getSite(siteId: string): Promise<Site | null> {
    const db = await this.db();
    const meta = await db.collection<SiteMeta>('sites').findOne({ id: siteId });
    if (!meta) return null;
    const pages = await this.listPages(siteId);
    return { meta, pages };
  }

  async createSite(name: string, domain?: string): Promise<Site> {
    const db = await this.db();
    const now = new Date().toISOString();
    const meta: SiteMeta = { id: nanoid(12), name, domain, createdAt: now, updatedAt: now };
    await db.collection<SiteMeta>('sites').insertOne(meta);
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
    const db = await this.db();
    const updatedAt = new Date().toISOString();
    // Split explicit-undefined keys into $unset so a field can be cleared (e.g. review),
    // matching the filesystem backend where `{ ...meta, review: undefined }` drops it.
    const set: Record<string, unknown> = { updatedAt };
    const unset: Record<string, ''> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) unset[key] = '';
      else set[key] = value;
    }
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    await db.collection<SiteMeta>('sites').updateOne({ id: siteId }, update);
    const meta = await db.collection<SiteMeta>('sites').findOne({ id: siteId });
    if (!meta) throw new Error(`Site not found: ${siteId}`);
    return meta;
  }

  async setClientPassword(siteId: string, passwordHash: string): Promise<void> {
    const db = await this.db();
    await db
      .collection<SiteMeta>('sites')
      .updateOne({ id: siteId }, { $set: { clientPasswordHash: passwordHash, updatedAt: new Date().toISOString() } });
  }

  async deleteSite(siteId: string): Promise<void> {
    const db = await this.db();
    await db.collection<SiteMeta>('sites').deleteOne({ id: siteId });
    await db.collection<SitePage>('pages').deleteMany({ siteId });
    await db.collection<SiteVersion>('versions').deleteMany({ siteId });
    await db.collection<FormSubmission>('submissions').deleteMany({ siteId });
    await db.collection<Subscriber>('subscribers').deleteMany({ siteId });
    await db.collection('authors').deleteMany({ siteId });
    await db.collection('categories').deleteMany({ siteId });
    await db.collection('tags').deleteMany({ siteId });
    await db.collection('mediaAssets').deleteMany({ siteId });
    await db.collection('articles').deleteMany({ siteId });
    await db.collection('comments').deleteMany({ siteId });
    await db.collection('importJobs').deleteMany({ siteId });
  }

  getSitePublicDir(siteId: string): string {
    const root = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
    return join(root, 'sites', siteId, 'public');
  }

  async listPages(siteId: string): Promise<SitePage[]> {
    const db = await this.db();
    return db.collection<SitePage>('pages').find({ siteId }).sort({ path: 1 }).toArray();
  }

  async getPage(siteId: string, pageId: string): Promise<SitePage | null> {
    const db = await this.db();
    return db.collection<SitePage>('pages').findOne({ siteId, id: pageId });
  }

  async upsertPage(
    siteId: string,
    page: Omit<SitePage, 'updatedAt'> & { updatedAt?: string }
  ): Promise<SitePage> {
    const db = await this.db();
    const saved: SitePage & { siteId: string } = {
      ...page,
      siteId,
      updatedAt: page.updatedAt ?? new Date().toISOString(),
    };
    await db.collection('pages').updateOne(
      { siteId, id: page.id },
      { $set: saved },
      { upsert: true }
    );
    await db.collection<SiteMeta>('sites').updateOne({ id: siteId }, { $set: { updatedAt: saved.updatedAt } });
    return saved;
  }

  async deletePage(siteId: string, pageId: string): Promise<void> {
    const db = await this.db();
    await db.collection<SitePage>('pages').deleteOne({ siteId, id: pageId });
  }

  async listVersions(siteId: string): Promise<SiteVersion[]> {
    const db = await this.db();
    return db
      .collection<SiteVersion & { siteId: string }>('versions')
      .find({ siteId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async getVersion(siteId: string, versionId: string): Promise<SiteVersion | null> {
    const db = await this.db();
    return db.collection<SiteVersion>('versions').findOne({ siteId, id: versionId });
  }

  async createVersion(siteId: string, label: string, options?: { publishId?: string }): Promise<SiteVersion> {
    const pages = await this.listPages(siteId);
    const version: SiteVersion & { siteId: string } = {
      id: nanoid(10),
      label,
      createdAt: new Date().toISOString(),
      ...(options?.publishId ? { publishId: options.publishId } : {}),
      pages: Object.fromEntries(pages.map((p) => [p.id, p.content])),
      siteId,
    };
    const db = await this.db();
    await db.collection('versions').insertOne(version);
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
    const db = await this.db();
    return db.collection<FormSubmission>('submissions').find({ siteId }).sort({ createdAt: -1 }).toArray();
  }

  async addSubmission(
    siteId: string,
    submission: Omit<FormSubmission, 'id' | 'siteId' | 'createdAt'>
  ): Promise<FormSubmission> {
    const db = await this.db();
    const saved: FormSubmission = {
      ...submission,
      id: nanoid(10),
      siteId,
      createdAt: new Date().toISOString(),
    };
    await db.collection<FormSubmission>('submissions').insertOne(saved);
    return saved;
  }

  async getSubmission(siteId: string, submissionId: string): Promise<FormSubmission | null> {
    const db = await this.db();
    return db.collection<FormSubmission>('submissions').findOne({ siteId, id: submissionId });
  }

  async listSubscribers(siteId: string): Promise<Subscriber[]> {
    const db = await this.db();
    return db.collection<Subscriber>('subscribers').find({ siteId }).sort({ createdAt: -1 }).toArray();
  }

  async findSubscriberByEmail(siteId: string, email: string): Promise<Subscriber | null> {
    const db = await this.db();
    return db.collection<Subscriber>('subscribers').findOne({ siteId, email: email.trim().toLowerCase() });
  }

  async findSubscriberByToken(
    siteId: string,
    field: 'confirmToken' | 'unsubscribeToken',
    token: string
  ): Promise<Subscriber | null> {
    if (!token) return null;
    const db = await this.db();
    return db.collection<Subscriber>('subscribers').findOne({ siteId, [field]: token });
  }

  async saveSubscriber(siteId: string, subscriber: Subscriber): Promise<Subscriber> {
    const db = await this.db();
    // replaceOne (not $set) so fields removed by a transform — e.g. confirmToken on confirm — actually go away.
    await db
      .collection<Subscriber>('subscribers')
      .replaceOne({ siteId, id: subscriber.id }, { ...subscriber, siteId }, { upsert: true });
    return subscriber;
  }

  async upsertAuthor(
    siteId: string,
    author: Omit<Author, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Author> {
    const db = await this.db();
    const saved: Author = { ...author, siteId, createdAt: author.createdAt ?? new Date().toISOString() };
    await db.collection<Author>('authors').updateOne({ siteId, id: author.id }, { $set: saved }, { upsert: true });
    return saved;
  }

  async listAuthors(siteId: string): Promise<Author[]> {
    const db = await this.db();
    return db.collection<Author>('authors').find({ siteId }).toArray();
  }

  async upsertCategory(
    siteId: string,
    category: Omit<Category, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Category> {
    const db = await this.db();
    const saved: Category = { ...category, siteId, createdAt: category.createdAt ?? new Date().toISOString() };
    await db.collection<Category>('categories').updateOne({ siteId, id: category.id }, { $set: saved }, { upsert: true });
    return saved;
  }

  async listCategories(siteId: string): Promise<Category[]> {
    const db = await this.db();
    return db.collection<Category>('categories').find({ siteId }).toArray();
  }

  async upsertTag(
    siteId: string,
    tag: Omit<Tag, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Tag> {
    const db = await this.db();
    const saved: Tag = { ...tag, siteId, createdAt: tag.createdAt ?? new Date().toISOString() };
    await db.collection<Tag>('tags').updateOne({ siteId, id: tag.id }, { $set: saved }, { upsert: true });
    return saved;
  }

  async listTags(siteId: string): Promise<Tag[]> {
    const db = await this.db();
    return db.collection<Tag>('tags').find({ siteId }).toArray();
  }

  async upsertMediaAsset(
    siteId: string,
    asset: Omit<MediaAsset, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<MediaAsset> {
    const db = await this.db();
    const saved: MediaAsset = { ...asset, siteId, createdAt: asset.createdAt ?? new Date().toISOString() };
    await db.collection<MediaAsset>('mediaAssets').updateOne({ siteId, id: asset.id }, { $set: saved }, { upsert: true });
    return saved;
  }

  async listMediaAssets(siteId: string): Promise<MediaAsset[]> {
    const db = await this.db();
    return db.collection<MediaAsset>('mediaAssets').find({ siteId }).toArray();
  }

  async upsertArticle(
    siteId: string,
    article: Omit<Article, 'siteId' | 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }
  ): Promise<Article> {
    const db = await this.db();
    const now = new Date().toISOString();
    const saved: Article = {
      ...article,
      siteId,
      createdAt: article.createdAt ?? now,
      updatedAt: article.updatedAt ?? now,
    };
    await db.collection<Article>('articles').updateOne({ siteId, id: article.id }, { $set: saved }, { upsert: true });
    return saved;
  }

  async listArticles(siteId: string): Promise<Article[]> {
    const db = await this.db();
    return db.collection<Article>('articles').find({ siteId }).toArray();
  }

  async getArticle(siteId: string, articleId: string): Promise<Article | null> {
    const db = await this.db();
    return db.collection<Article>('articles').findOne({ siteId, id: articleId });
  }

  async upsertComment(
    siteId: string,
    comment: Omit<Comment, 'siteId' | 'createdAt'> & { createdAt?: string }
  ): Promise<Comment> {
    const db = await this.db();
    const saved: Comment = { ...comment, siteId, createdAt: comment.createdAt ?? new Date().toISOString() };
    await db.collection<Comment>('comments').updateOne({ siteId, id: comment.id }, { $set: saved }, { upsert: true });
    return saved;
  }

  async listComments(siteId: string): Promise<Comment[]> {
    const db = await this.db();
    return db.collection<Comment>('comments').find({ siteId }).toArray();
  }

  async createImportJob(siteId: string): Promise<ImportJob> {
    const db = await this.db();
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
    await db.collection<ImportJob>('importJobs').insertOne(job);
    await mkdir(join(this.getSitePublicDir(siteId), 'wp-content', 'uploads'), { recursive: true });
    return job;
  }

  async getImportJob(siteId: string, jobId: string): Promise<ImportJob | null> {
    const db = await this.db();
    return db.collection<ImportJob>('importJobs').findOne({ siteId, id: jobId });
  }

  async updateImportJob(siteId: string, job: ImportJob): Promise<ImportJob> {
    const db = await this.db();
    const updated = { ...job, updatedAt: new Date().toISOString() };
    await db.collection<ImportJob>('importJobs').updateOne({ siteId, id: job.id }, { $set: updated });
    return updated;
  }
}
