import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { Db } from 'mongodb';

/**
 * Per-site connector token — the credential the WordPress Connector plugin sends
 * to the Connect API. Mirrors the session-token model in workspace-users.ts: we
 * store ONLY a sha256 hash, never the plaintext, and hand the plaintext back
 * exactly once at issue time. One active token per site — issuing again rotates
 * (the old hash stops resolving), and revoking deletes it (immediate 401).
 */

export function hashConnectorToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const ConnectorTokenSchema = z.object({
  siteId: z.string(),
  tokenHash: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
});
export type ConnectorTokenRecord = z.infer<typeof ConnectorTokenSchema>;

export interface ConnectorTokenStatus {
  connected: boolean;
  createdAt?: string;
  lastUsedAt?: string;
}

export class ConnectorTokenStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'connector-tokens');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private recordPath(siteId: string) {
    return join(this.dataDir, `${siteId}.json`);
  }

  private async save(record: ConnectorTokenRecord): Promise<void> {
    const validated = ConnectorTokenSchema.parse(record);
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('connector_tokens')
        .updateOne({ siteId: validated.siteId }, { $set: validated }, { upsert: true });
      return;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.recordPath(validated.siteId), JSON.stringify(validated, null, 2), 'utf-8');
  }

  private async getBySite(siteId: string): Promise<ConnectorTokenRecord | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<ConnectorTokenRecord>('connector_tokens').findOne({ siteId });
      return doc ? ConnectorTokenSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.recordPath(siteId), 'utf-8');
      return ConnectorTokenSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Rotate/issue a token for a site. Returns the plaintext ONCE — it is never recoverable after. */
  async issue(siteId: string): Promise<{ token: string }> {
    const token = nanoid(32);
    await this.save({
      siteId,
      tokenHash: hashConnectorToken(token),
      createdAt: new Date().toISOString(),
    });
    return { token };
  }

  /** Resolve a presented token's hash to the site it grants access to, or null if unknown/revoked. */
  async resolveSiteId(tokenHash: string): Promise<string | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<ConnectorTokenRecord>('connector_tokens').findOne({ tokenHash });
      return doc ? doc.siteId : null;
    }
    try {
      const files = await readdir(this.dataDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const rec = ConnectorTokenSchema.parse(JSON.parse(await readFile(join(this.dataDir, f), 'utf-8')));
        if (rec.tokenHash === tokenHash) return rec.siteId;
      }
    } catch {
      /* no tokens issued yet */
    }
    return null;
  }

  /** Best-effort last-used stamp — callers fire-and-forget; never block a request on this. */
  async touch(tokenHash: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('connector_tokens').updateOne({ tokenHash }, { $set: { lastUsedAt: now } });
      return;
    }
    const siteId = await this.resolveSiteId(tokenHash);
    if (!siteId) return;
    const rec = await this.getBySite(siteId);
    if (rec) await this.save({ ...rec, lastUsedAt: now });
  }

  async revoke(siteId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('connector_tokens').deleteOne({ siteId });
      return;
    }
    await rm(this.recordPath(siteId), { force: true });
  }

  /** Masked status for the dashboard — whether a token exists, and when it was issued/last used. */
  async getStatus(siteId: string): Promise<ConnectorTokenStatus> {
    const rec = await this.getBySite(siteId);
    if (!rec) return { connected: false };
    return { connected: true, createdAt: rec.createdAt, lastUsedAt: rec.lastUsedAt };
  }
}

let storeInstance: ConnectorTokenStore | null = null;

export async function getConnectorTokenStore(): Promise<ConnectorTokenStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new ConnectorTokenStore({
      dbPromise: client.connect().then(() => client.db(dbName)),
    });
  } else {
    storeInstance = new ConnectorTokenStore();
  }
  return storeInstance;
}
