import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import type { EmailFolder, EmailSystemFolderType } from '../content/email-inbox-types.js';

const SYSTEM_FOLDERS: Array<{ systemType: EmailSystemFolderType; name: string; order: number }> = [
  { systemType: 'inbox', name: 'Inbox', order: 0 },
  { systemType: 'drafts', name: 'Drafts', order: 1 },
  { systemType: 'sent', name: 'Sent', order: 2 },
];

export class EmailFolderStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'email-folders');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private siteDir(siteId: string) {
    return join(this.dataDir, siteId);
  }

  private filePath(siteId: string, id: string) {
    return join(this.siteDir(siteId), `${id}.json`);
  }

  async list(siteId: string): Promise<EmailFolder[]> {
    let folders: EmailFolder[];
    if (this.dbPromise) {
      const db = await this.dbPromise;
      folders = await db.collection<EmailFolder>('email_folders').find({ siteId }).toArray();
    } else {
      try {
        const files = await readdir(this.siteDir(siteId));
        folders = [];
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          folders.push(JSON.parse(await readFile(join(this.siteDir(siteId), f), 'utf-8')) as EmailFolder);
        }
      } catch {
        folders = [];
      }
    }
    return folders.sort((a, b) => a.order - b.order);
  }

  async get(siteId: string, id: string): Promise<EmailFolder | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<EmailFolder>('email_folders').findOne({ siteId, id });
    }
    try {
      return JSON.parse(await readFile(this.filePath(siteId, id), 'utf-8')) as EmailFolder;
    } catch {
      return null;
    }
  }

  async save(folder: EmailFolder): Promise<EmailFolder> {
    const stamped: EmailFolder = { ...folder, updatedAt: new Date().toISOString() };
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('email_folders')
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
      await db.collection('email_folders').deleteOne({ siteId, id });
      return;
    }
    await unlink(this.filePath(siteId, id)).catch(() => {});
  }

  /** Lazily seeds Inbox/Drafts/Sent for a site on first access. Idempotent. */
  async ensureSystemFolders(siteId: string): Promise<EmailFolder[]> {
    const existing = await this.list(siteId);
    const now = new Date().toISOString();
    for (const sys of SYSTEM_FOLDERS) {
      if (existing.some((f) => f.systemType === sys.systemType)) continue;
      const folder: EmailFolder = {
        id: `fld_${nanoid(10)}`,
        siteId,
        name: sys.name,
        kind: 'system',
        systemType: sys.systemType,
        order: sys.order,
        createdAt: now,
        updatedAt: now,
      };
      existing.push(await this.save(folder));
    }
    return existing.sort((a, b) => a.order - b.order);
  }
}

let storeInstance: EmailFolderStore | null = null;

export async function getEmailFolderStore(): Promise<EmailFolderStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new EmailFolderStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new EmailFolderStore();
  }
  return storeInstance;
}
