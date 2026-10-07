import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import {
  SocialGenerationBatchSchema,
  SocialPostDraftSchema,
  type SocialGenerationBatch,
  type SocialPostDraft,
} from '../content/social-types.js';

export class SocialPostsStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'social');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private batchDir(siteId: string) {
    return join(this.dataDir, siteId, 'batches');
  }

  private draftDir(siteId: string) {
    return join(this.dataDir, siteId, 'drafts');
  }

  async listBatches(siteId: string, filters?: { sourcePostId?: string; status?: string }): Promise<SocialGenerationBatch[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const query: Record<string, unknown> = { siteId };
      if (filters?.sourcePostId) query.sourcePostId = filters.sourcePostId;
      if (filters?.status) query.status = filters.status;
      return db.collection<SocialGenerationBatch>('social_batches').find(query).sort({ createdAt: -1 }).toArray();
    }
    try {
      const files = await readdir(this.batchDir(siteId));
      const out: SocialGenerationBatch[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const batch = SocialGenerationBatchSchema.parse(
          JSON.parse(await readFile(join(this.batchDir(siteId), f), 'utf-8'))
        );
        if (filters?.sourcePostId && batch.sourcePostId !== filters.sourcePostId) continue;
        if (filters?.status && batch.status !== filters.status) continue;
        out.push(batch);
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async getBatch(siteId: string, batchId: string): Promise<SocialGenerationBatch | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<SocialGenerationBatch>('social_batches').findOne({ siteId, id: batchId });
      return doc ? SocialGenerationBatchSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(join(this.batchDir(siteId), `${batchId}.json`), 'utf-8');
      return SocialGenerationBatchSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveBatch(batch: SocialGenerationBatch): Promise<SocialGenerationBatch> {
    const validated = SocialGenerationBatchSchema.parse(batch);
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('social_batches').updateOne(
        { siteId: validated.siteId, id: validated.id },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    const dir = this.batchDir(validated.siteId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${validated.id}.json`), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async createBatch(
    data: Omit<SocialGenerationBatch, 'id' | 'createdAt' | 'status'> & { status?: SocialGenerationBatch['status'] }
  ): Promise<SocialGenerationBatch> {
    const batch: SocialGenerationBatch = {
      ...data,
      id: nanoid(12),
      status: data.status ?? 'pending_review',
      createdAt: new Date().toISOString(),
    };
    return this.saveBatch(batch);
  }

  async listDrafts(
    siteId: string,
    filters?: { sourcePostId?: string; platform?: string; status?: string }
  ): Promise<SocialPostDraft[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const query: Record<string, unknown> = { siteId };
      if (filters?.sourcePostId) query.sourcePostId = filters.sourcePostId;
      if (filters?.platform) query.platform = filters.platform;
      if (filters?.status) query.status = filters.status;
      return db.collection<SocialPostDraft>('social_drafts').find(query).sort({ updatedAt: -1 }).toArray();
    }
    try {
      const files = await readdir(this.draftDir(siteId));
      const out: SocialPostDraft[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const draft = SocialPostDraftSchema.parse(
          JSON.parse(await readFile(join(this.draftDir(siteId), f), 'utf-8'))
        );
        if (filters?.sourcePostId && draft.sourcePostId !== filters.sourcePostId) continue;
        if (filters?.platform && draft.platform !== filters.platform) continue;
        if (filters?.status && draft.status !== filters.status) continue;
        out.push(draft);
      }
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  async getDraft(siteId: string, draftId: string): Promise<SocialPostDraft | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<SocialPostDraft>('social_drafts').findOne({ siteId, id: draftId });
      return doc ? SocialPostDraftSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(join(this.draftDir(siteId), `${draftId}.json`), 'utf-8');
      return SocialPostDraftSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveDraft(draft: SocialPostDraft): Promise<SocialPostDraft> {
    const validated = SocialPostDraftSchema.parse({
      ...draft,
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('social_drafts').updateOne(
        { siteId: validated.siteId, id: validated.id },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    const dir = this.draftDir(validated.siteId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${validated.id}.json`), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async createDraft(
    data: Omit<SocialPostDraft, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: SocialPostDraft['status'] }
  ): Promise<SocialPostDraft> {
    const now = new Date().toISOString();
    const draft: SocialPostDraft = {
      ...data,
      id: nanoid(12),
      status: data.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
    };
    return this.saveDraft(draft);
  }

  async deleteDraft(siteId: string, draftId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('social_drafts').deleteOne({ siteId, id: draftId });
      return;
    }
    await rm(join(this.draftDir(siteId), `${draftId}.json`), { force: true });
  }
}

let storeInstance: SocialPostsStore | null = null;

export async function getSocialPostsStore(): Promise<SocialPostsStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new SocialPostsStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new SocialPostsStore();
  }
  return storeInstance;
}
