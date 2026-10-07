import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import { StyleGuideSchema, type StyleGuide } from '../design/style-guide.js';
import { sanitizeStyleGuideTokens } from '../guardian/sanitize-style-guide.js';

export class StyleGuideStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'style-guides');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private guidePath(siteId: string) {
    return join(this.dataDir, `${siteId}.json`);
  }

  async get(siteId: string): Promise<StyleGuide | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<StyleGuide>('style_guides').findOne({ siteId });
      return doc ? StyleGuideSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.guidePath(siteId), 'utf-8');
      return StyleGuideSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(siteId: string, guide: StyleGuide): Promise<StyleGuide> {
    // Every write path (apply/generate/PATCH/chat, both backends) funnels
    // through here — the one choke point where free-form token values from
    // parsed DESIGN.md / AI output get swept before they can reach a <style>.
    const { guide: sanitized, warnings } = sanitizeStyleGuideTokens(guide);
    for (const w of warnings) console.warn(`[style-guide] ${siteId}: ${w}`);
    const validated = StyleGuideSchema.parse(sanitized);
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('style_guides').updateOne(
        { siteId },
        { $set: { ...validated, siteId } },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.guidePath(siteId), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async delete(siteId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('style_guides').deleteOne({ siteId });
      return;
    }
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.guidePath(siteId));
    } catch {
      // ignore
    }
  }
}

let storeInstance: StyleGuideStore | null = null;

export async function getStyleGuideStore(): Promise<StyleGuideStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    const dbPromise = client.connect().then(() => client.db(dbName));
    storeInstance = new StyleGuideStore({ dbPromise });
  } else {
    storeInstance = new StyleGuideStore();
  }
  return storeInstance;
}
