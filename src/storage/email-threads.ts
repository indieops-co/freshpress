import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import type { EmailThread } from '../content/email-inbox-types.js';

export class EmailThreadStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'email-threads');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private siteDir(siteId: string) {
    return join(this.dataDir, siteId);
  }

  private filePath(siteId: string, id: string) {
    return join(this.siteDir(siteId), `${id}.json`);
  }

  /** Lists threads for a site, newest-first. Pass folderId to scope to one folder. */
  async list(siteId: string, folderId?: string): Promise<EmailThread[]> {
    let threads: EmailThread[];
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const query = folderId ? { siteId, folderId } : { siteId };
      threads = await db.collection<EmailThread>('email_threads').find(query).toArray();
    } else {
      try {
        const files = await readdir(this.siteDir(siteId));
        threads = [];
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          const thread = JSON.parse(await readFile(join(this.siteDir(siteId), f), 'utf-8')) as EmailThread;
          if (!folderId || thread.folderId === folderId) threads.push(thread);
        }
      } catch {
        threads = [];
      }
    }
    return threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  async get(siteId: string, id: string): Promise<EmailThread | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<EmailThread>('email_threads').findOne({ siteId, id });
    }
    try {
      return JSON.parse(await readFile(this.filePath(siteId, id), 'utf-8')) as EmailThread;
    } catch {
      return null;
    }
  }

  async save(thread: EmailThread): Promise<EmailThread> {
    const stamped: EmailThread = { ...thread, updatedAt: new Date().toISOString() };
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('email_threads')
        .updateOne({ siteId: stamped.siteId, id: stamped.id }, { $set: stamped }, { upsert: true });
      return stamped;
    }
    await mkdir(this.siteDir(stamped.siteId), { recursive: true });
    await writeFile(this.filePath(stamped.siteId, stamped.id), JSON.stringify(stamped, null, 2), 'utf-8');
    return stamped;
  }

  async delete(siteId: string, id: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('email_threads').deleteOne({ siteId, id });
      return;
    }
    await unlink(this.filePath(siteId, id)).catch(() => {});
  }
}

let storeInstance: EmailThreadStore | null = null;

export async function getEmailThreadStore(): Promise<EmailThreadStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new EmailThreadStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new EmailThreadStore();
  }
  return storeInstance;
}
