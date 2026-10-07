import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Db } from 'mongodb';

/**
 * Latest WordPress-side sync report per site — the status channel the plugin posts
 * back after each non-dry sync (Phase 3, Chunk 6). Mirrors connector-tokens.ts:
 * one record per site, dual Mongo/filesystem, singleton accessor. We keep only the
 * LATEST report (a running log isn't needed for the editor's "last synced" line).
 *
 * The report is a trimmed summary (counts + timestamp), not the full action list —
 * the plugin sends what FP_Sync_Engine::summarize_report() produces. Fields are
 * bounded so a compromised/buggy plugin can't store an oversized blob; unknown keys
 * are stripped (forward-compatible with a newer plugin that adds fields).
 */

const COUNT = z.number().int().min(0).max(1_000_000);

/** The body the plugin POSTs. snake_case to match the plugin's summarize_report(). */
export const ConnectorSyncReportSchema = z.object({
  ran_at: z.string().max(40),
  ok: z.boolean(),
  site: z.string().max(200).default(''),
  created: COUNT.default(0),
  updated: COUNT.default(0),
  skipped: COUNT.default(0),
  drafted: COUNT.default(0),
  errors: COUNT.default(0),
  error: z.string().max(500).optional(),
});
export type ConnectorSyncReport = z.infer<typeof ConnectorSyncReportSchema>;

const StoredSyncReportSchema = ConnectorSyncReportSchema.extend({
  siteId: z.string(),
  /** Server clock when the report arrived — the reliable "last synced" time (client clocks skew). */
  receivedAt: z.string(),
});
export type StoredSyncReport = z.infer<typeof StoredSyncReportSchema>;

export class ConnectorSyncReportStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'connector-sync-reports');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private recordPath(siteId: string) {
    return join(this.dataDir, `${siteId}.json`);
  }

  /** Persist the latest report for a site (overwrites the previous one). */
  async save(siteId: string, report: ConnectorSyncReport, receivedAt: string): Promise<StoredSyncReport> {
    const stored = StoredSyncReportSchema.parse({ ...report, siteId, receivedAt });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('connector_sync_reports')
        .updateOne({ siteId }, { $set: stored }, { upsert: true });
      return stored;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.recordPath(siteId), JSON.stringify(stored, null, 2), 'utf-8');
    return stored;
  }

  async get(siteId: string): Promise<StoredSyncReport | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<StoredSyncReport>('connector_sync_reports').findOne({ siteId });
      return doc ? StoredSyncReportSchema.parse(doc) : null;
    }
    try {
      return StoredSyncReportSchema.parse(JSON.parse(await readFile(this.recordPath(siteId), 'utf-8')));
    } catch {
      return null;
    }
  }

  async delete(siteId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('connector_sync_reports').deleteOne({ siteId });
      return;
    }
    await rm(this.recordPath(siteId), { force: true });
  }
}

let storeInstance: ConnectorSyncReportStore | null = null;

export async function getConnectorSyncReportStore(): Promise<ConnectorSyncReportStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new ConnectorSyncReportStore({
      dbPromise: client.connect().then(() => client.db(dbName)),
    });
  } else {
    storeInstance = new ConnectorSyncReportStore();
  }
  return storeInstance;
}
