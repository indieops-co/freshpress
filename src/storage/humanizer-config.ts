import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import {
  HumanizerSiteConfigSchema,
  HumanizerWorkspaceDefaultsSchema,
  type HumanizerSiteConfig,
  type HumanizerWorkspaceDefaults,
} from '../humanizer/types.js';

const DEFAULTS: HumanizerWorkspaceDefaults = {
  defaultMode: 'simple',
};

function defaultSiteConfig(siteId: string): HumanizerSiteConfig {
  const now = new Date().toISOString();
  return HumanizerSiteConfigSchema.parse({
    siteId,
    mode: 'simple',
    tone: 'friendly-professional',
    readingLevel: "Bachelor's degree in liberal arts",
    contentTypeHint: 'auto',
    updatedAt: now,
  });
}

export class HumanizerConfigStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'humanizer');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private sitePath(siteId: string) {
    return join(this.dataDir, 'sites', `${siteId}.json`);
  }

  private workspacePath() {
    return join(this.dataDir, 'workspace-defaults.json');
  }

  async getSiteConfig(siteId: string): Promise<HumanizerSiteConfig | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<HumanizerSiteConfig>('humanizer_site_configs').findOne({ siteId });
      return doc ? HumanizerSiteConfigSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.sitePath(siteId), 'utf-8');
      return HumanizerSiteConfigSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async getOrCreateSiteConfig(siteId: string): Promise<HumanizerSiteConfig> {
    const existing = await this.getSiteConfig(siteId);
    if (existing) return existing;
    return defaultSiteConfig(siteId);
  }

  async saveSiteConfig(config: HumanizerSiteConfig): Promise<HumanizerSiteConfig> {
    const validated = HumanizerSiteConfigSchema.parse({
      ...config,
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('humanizer_site_configs').updateOne(
        { siteId: validated.siteId },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(join(this.dataDir, 'sites'), { recursive: true });
    await writeFile(this.sitePath(validated.siteId), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async getWorkspaceDefaults(): Promise<HumanizerWorkspaceDefaults> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db
        .collection<HumanizerWorkspaceDefaults & { key: string }>('humanizer_workspace')
        .findOne({ key: 'defaults' });
      if (!doc) return DEFAULTS;
      const { key: _key, ...rest } = doc;
      return HumanizerWorkspaceDefaultsSchema.parse(rest);
    }
    try {
      const raw = await readFile(this.workspacePath(), 'utf-8');
      return HumanizerWorkspaceDefaultsSchema.parse(JSON.parse(raw));
    } catch {
      return DEFAULTS;
    }
  }

  async saveWorkspaceDefaults(defaults: HumanizerWorkspaceDefaults): Promise<HumanizerWorkspaceDefaults> {
    const validated = HumanizerWorkspaceDefaultsSchema.parse({
      ...defaults,
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('humanizer_workspace').updateOne(
        { key: 'defaults' },
        { $set: { ...validated, key: 'defaults' } },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.workspacePath(), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }
}

let storeInstance: HumanizerConfigStore | null = null;

export async function getHumanizerConfigStore(): Promise<HumanizerConfigStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    const dbPromise = client.connect().then(() => client.db(dbName));
    storeInstance = new HumanizerConfigStore({ dbPromise });
  } else {
    storeInstance = new HumanizerConfigStore();
  }
  return storeInstance;
}
