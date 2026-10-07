import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import { SocialSiteConfigSchema, type SocialSiteConfig } from '../content/social-types.js';

function defaultConfig(siteId: string): SocialSiteConfig {
  const now = new Date().toISOString();
  return SocialSiteConfigSchema.parse({
    siteId,
    accounts: [],
    autoGenerateOnPublish: true,
    defaultFullScreenCards: true,
    updatedAt: now,
  });
}

export class SocialConfigStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'social-config');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private sitePath(siteId: string) {
    return join(this.dataDir, `${siteId}.json`);
  }

  async getConfig(siteId: string): Promise<SocialSiteConfig | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<SocialSiteConfig>('social_site_configs').findOne({ siteId });
      return doc ? SocialSiteConfigSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.sitePath(siteId), 'utf-8');
      return SocialSiteConfigSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async getOrCreateConfig(siteId: string): Promise<SocialSiteConfig> {
    const existing = await this.getConfig(siteId);
    if (existing) return existing;
    return defaultConfig(siteId);
  }

  async saveConfig(config: SocialSiteConfig): Promise<SocialSiteConfig> {
    const validated = SocialSiteConfigSchema.parse({
      ...config,
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('social_site_configs').updateOne(
        { siteId: validated.siteId },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.sitePath(validated.siteId), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }
}

let storeInstance: SocialConfigStore | null = null;

export async function getSocialConfigStore(): Promise<SocialConfigStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new SocialConfigStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new SocialConfigStore();
  }
  return storeInstance;
}
