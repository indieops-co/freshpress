import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import {
  BrandResearchSchema,
  type BrandResearch,
  buildDefaultBrandResearch,
} from '../content/brand-research-types.js';

export class BrandResearchStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'brand-research');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private researchPath(siteId: string) {
    return join(this.dataDir, `${siteId}.json`);
  }

  /**
   * Null means "no research yet". A corrupt or schema-incompatible file THROWS instead —
   * returning null here would make getOrCreate fabricate a default that the next save()
   * writes over the user's real research.
   */
  async get(siteId: string): Promise<BrandResearch | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<BrandResearch>('brand_research').findOne({ siteId });
      return doc ? BrandResearchSchema.parse(doc) : null;
    }
    let raw: string;
    try {
      raw = await readFile(this.researchPath(siteId), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    return BrandResearchSchema.parse(JSON.parse(raw));
  }

  async getOrCreate(siteId: string): Promise<BrandResearch> {
    const existing = await this.get(siteId);
    return existing ?? buildDefaultBrandResearch(siteId, new Date().toISOString());
  }

  async save(siteId: string, research: BrandResearch): Promise<BrandResearch> {
    const validated = BrandResearchSchema.parse({
      ...research,
      siteId,
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('brand_research').updateOne(
        { siteId },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.researchPath(siteId), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async delete(siteId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('brand_research').deleteOne({ siteId });
      return;
    }
    try {
      await unlink(this.researchPath(siteId));
    } catch {
      // already gone
    }
  }
}

let storeInstance: BrandResearchStore | null = null;

export async function getBrandResearchStore(): Promise<BrandResearchStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    const dbPromise = client.connect().then(() => client.db(dbName));
    storeInstance = new BrandResearchStore({ dbPromise });
  } else {
    storeInstance = new BrandResearchStore();
  }
  return storeInstance;
}
