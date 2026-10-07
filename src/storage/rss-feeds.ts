import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';

export interface RssFeed {
  id: string;
  siteId: string;
  url: string;
  label: string;
  createdAt: string;
}

export class RssFeedStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'rss-feeds');
    this.dbPromise = options?.dbPromise ?? null;
  }

  async list(siteId: string): Promise<RssFeed[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<RssFeed>('rss_feeds').find({ siteId }).toArray();
    }
    try {
      const raw = await readFile(join(this.dataDir, `${siteId}.json`), 'utf-8');
      return JSON.parse(raw) as RssFeed[];
    } catch {
      return [];
    }
  }

  async add(siteId: string, url: string, label: string): Promise<RssFeed> {
    const feeds = await this.list(siteId);
    const feed: RssFeed = { id: nanoid(8), siteId, url, label, createdAt: new Date().toISOString() };
    feeds.push(feed);
    await this.saveAll(siteId, feeds);
    return feed;
  }

  private async saveAll(siteId: string, feeds: RssFeed[]): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('rss_feeds').deleteMany({ siteId });
      if (feeds.length) await db.collection('rss_feeds').insertMany(feeds);
      return;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(join(this.dataDir, `${siteId}.json`), JSON.stringify(feeds, null, 2), 'utf-8');
  }
}

let store: RssFeedStore | null = null;

export async function getRssFeedStore(): Promise<RssFeedStore> {
  if (store) return store;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    store = new RssFeedStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    store = new RssFeedStore();
  }
  return store;
}
