import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import type { EmailMessage } from '../content/email-inbox-types.js';

export class EmailMessageStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'email-messages');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private siteDir(siteId: string) {
    return join(this.dataDir, siteId);
  }

  private filePath(siteId: string, id: string) {
    return join(this.siteDir(siteId), `${id}.json`);
  }

  /** Lists every message for a site (all threads). FS mode has no per-site index beyond the directory listing. */
  async listAll(siteId: string): Promise<EmailMessage[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<EmailMessage>('email_messages').find({ siteId }).toArray();
    }
    try {
      const files = await readdir(this.siteDir(siteId));
      const out: EmailMessage[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        out.push(JSON.parse(await readFile(join(this.siteDir(siteId), f), 'utf-8')) as EmailMessage);
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Lists messages in a thread, oldest-first (display order). */
  async listByThread(siteId: string, threadId: string): Promise<EmailMessage[]> {
    const all = await this.listAll(siteId);
    return all.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  /** Finds the message that owns a given Message-Id header value, used to resolve reply threading. */
  async findByMessageIdHeader(siteId: string, messageIdHeader: string): Promise<EmailMessage | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<EmailMessage>('email_messages').findOne({ siteId, messageIdHeader });
    }
    const all = await this.listAll(siteId);
    return all.find((m) => m.messageIdHeader === messageIdHeader) ?? null;
  }

  async get(siteId: string, id: string): Promise<EmailMessage | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<EmailMessage>('email_messages').findOne({ siteId, id });
    }
    try {
      return JSON.parse(await readFile(this.filePath(siteId, id), 'utf-8')) as EmailMessage;
    } catch {
      return null;
    }
  }

  async save(message: EmailMessage): Promise<EmailMessage> {
    const stamped: EmailMessage = { ...message, updatedAt: new Date().toISOString() };
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('email_messages')
        .updateOne({ siteId: stamped.siteId, id: stamped.id }, { $set: stamped }, { upsert: true });
      return stamped;
    }
    await mkdir(this.siteDir(stamped.siteId), { recursive: true });
    await writeFile(this.filePath(stamped.siteId, stamped.id), JSON.stringify(stamped, null, 2), 'utf-8');
    return stamped;
  }

  /** Lists every scheduled message due to send by `now`, across all sites — used by the background scheduler. */
  async listScheduledDue(now: string): Promise<EmailMessage[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db
        .collection<EmailMessage>('email_messages')
        .find({ status: 'scheduled', scheduledAt: { $lte: now } })
        .toArray();
    }
    let siteIds: string[];
    try {
      siteIds = await readdir(this.dataDir);
    } catch {
      return [];
    }
    const out: EmailMessage[] = [];
    for (const siteId of siteIds) {
      const messages = await this.listAll(siteId);
      for (const m of messages) {
        if (m.status === 'scheduled' && m.scheduledAt !== undefined && m.scheduledAt <= now) {
          out.push(m);
        }
      }
    }
    return out;
  }

  async delete(siteId: string, id: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('email_messages').deleteOne({ siteId, id });
      return;
    }
    await unlink(this.filePath(siteId, id)).catch(() => {});
  }
}

let storeInstance: EmailMessageStore | null = null;

export async function getEmailMessageStore(): Promise<EmailMessageStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new EmailMessageStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new EmailMessageStore();
  }
  return storeInstance;
}
