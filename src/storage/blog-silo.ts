import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import type { BlogPillar, BlogPost, BlogSiloView } from '../content/silo-types.js';

export class BlogSiloStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'blog-silo');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private pillarDir(siteId: string) {
    return join(this.dataDir, siteId, 'pillars');
  }

  private postDir(siteId: string) {
    return join(this.dataDir, siteId, 'posts');
  }

  async listPillars(siteId: string): Promise<BlogPillar[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db
        .collection<BlogPillar>('blog_pillars')
        .find({ siteId })
        .sort({ order: 1 })
        .toArray();
    }
    try {
      const dir = this.pillarDir(siteId);
      const files = await readdir(dir);
      const pillars: BlogPillar[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        pillars.push(JSON.parse(await readFile(join(dir, f), 'utf-8')) as BlogPillar);
      }
      return pillars.sort((a, b) => a.order - b.order);
    } catch {
      return [];
    }
  }

  async listPosts(siteId: string, pillarId?: string): Promise<BlogPost[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const filter: { siteId: string; pillarId?: string } = { siteId };
      if (pillarId) filter.pillarId = pillarId;
      return db.collection<BlogPost>('blog_posts').find(filter).sort({ order: 1 }).toArray();
    }
    try {
      const dir = this.postDir(siteId);
      const files = await readdir(dir);
      const posts: BlogPost[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const post = JSON.parse(await readFile(join(dir, f), 'utf-8')) as BlogPost;
        if (!pillarId || post.pillarId === pillarId) posts.push(post);
      }
      return posts.sort((a, b) => a.order - b.order);
    } catch {
      return [];
    }
  }

  async listSilos(siteId: string): Promise<BlogSiloView[]> {
    const pillars = await this.listPillars(siteId);
    const allPosts = await this.listPosts(siteId);
    return pillars.map((pillar) => ({
      pillar,
      posts: allPosts.filter((p) => p.pillarId === pillar.id),
    }));
  }

  async getPillar(siteId: string, pillarId: string): Promise<BlogPillar | null> {
    const pillars = await this.listPillars(siteId);
    return pillars.find((p) => p.id === pillarId) ?? null;
  }

  async getPost(siteId: string, postId: string): Promise<BlogPost | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<BlogPost>('blog_posts').findOne({ siteId, id: postId });
    }
    try {
      const raw = await readFile(join(this.postDir(siteId), `${postId}.json`), 'utf-8');
      return JSON.parse(raw) as BlogPost;
    } catch {
      return null;
    }
  }

  async createPillar(
    siteId: string,
    data: Pick<BlogPillar, 'keyword' | 'slug' | 'title'> & Partial<BlogPillar>
  ): Promise<BlogPillar> {
    const pillars = await this.listPillars(siteId);
    const now = new Date().toISOString();
    const pillar: BlogPillar = {
      id: nanoid(12),
      siteId,
      keyword: data.keyword,
      slug: data.slug,
      title: data.title,
      metaTitle: data.metaTitle ?? data.title.slice(0, 58),
      metaDescription: data.metaDescription,
      order: data.order ?? pillars.length,
      createdAt: now,
      updatedAt: now,
    };
    await this.savePillar(pillar);
    return pillar;
  }

  async savePillar(pillar: BlogPillar): Promise<BlogPillar> {
    pillar.updatedAt = new Date().toISOString();
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('blog_pillars').updateOne(
        { siteId: pillar.siteId, id: pillar.id },
        { $set: pillar },
        { upsert: true }
      );
      return pillar;
    }
    const dir = this.pillarDir(pillar.siteId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${pillar.id}.json`), JSON.stringify(pillar, null, 2), 'utf-8');
    return pillar;
  }

  async createPost(
    siteId: string,
    data: Pick<BlogPost, 'pillarId' | 'kind' | 'title' | 'slug' | 'keyword'> & Partial<BlogPost>
  ): Promise<BlogPost> {
    const posts = await this.listPosts(siteId, data.pillarId);
    const now = new Date().toISOString();
    const post: BlogPost = {
      id: nanoid(12),
      siteId,
      pillarId: data.pillarId,
      kind: data.kind,
      title: data.title,
      slug: data.slug,
      keyword: data.keyword,
      bodyHtml: data.bodyHtml ?? '<p></p>',
      status: data.status ?? 'draft',
      metaTitle: data.metaTitle ?? data.title.slice(0, 58),
      metaDescription: data.metaDescription,
      order: data.order ?? posts.length,
      createdAt: now,
      updatedAt: now,
    };
    await this.savePost(post);
    return post;
  }

  async savePost(post: BlogPost): Promise<BlogPost> {
    post.updatedAt = new Date().toISOString();
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('blog_posts').updateOne(
        { siteId: post.siteId, id: post.id },
        { $set: post },
        { upsert: true }
      );
      return post;
    }
    const dir = this.postDir(post.siteId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${post.id}.json`), JSON.stringify(post, null, 2), 'utf-8');
    return post;
  }

  async deletePost(siteId: string, postId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('blog_posts').deleteOne({ siteId, id: postId });
      return;
    }
    await rm(join(this.postDir(siteId), `${postId}.json`), { force: true });
  }
}

let storeInstance: BlogSiloStore | null = null;

export async function getBlogSiloStore(): Promise<BlogSiloStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    const dbPromise = client.connect().then(() => client.db(dbName));
    storeInstance = new BlogSiloStore({ dbPromise });
  } else {
    storeInstance = new BlogSiloStore();
  }
  return storeInstance;
}
