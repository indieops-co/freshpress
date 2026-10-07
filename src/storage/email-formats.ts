import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import { EmailFormatSchema, type EmailFormat } from '../design/email-format.js';

/** Many-per-site store (a site can have several named Formats), keyed by {siteId, id}. */
export class EmailFormatStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'email-formats');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private siteDir(siteId: string) {
    return join(this.dataDir, siteId);
  }

  private filePath(siteId: string, id: string) {
    return join(this.siteDir(siteId), `${id}.json`);
  }

  async list(siteId: string): Promise<EmailFormat[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const docs = await db.collection<EmailFormat>('email_formats').find({ siteId }).toArray();
      return docs.map((d) => EmailFormatSchema.parse(d));
    }
    try {
      const files = await readdir(this.siteDir(siteId));
      const out: EmailFormat[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const raw = JSON.parse(await readFile(join(this.siteDir(siteId), f), 'utf-8'));
        out.push(EmailFormatSchema.parse(raw));
      }
      return out;
    } catch {
      return [];
    }
  }

  async get(siteId: string, id: string): Promise<EmailFormat | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<EmailFormat>('email_formats').findOne({ siteId, id });
      return doc ? EmailFormatSchema.parse(doc) : null;
    }
    try {
      const raw = JSON.parse(await readFile(this.filePath(siteId, id), 'utf-8'));
      return EmailFormatSchema.parse(raw);
    } catch {
      return null;
    }
  }

  async save(format: EmailFormat): Promise<EmailFormat> {
    const validated = EmailFormatSchema.parse({ ...format, updatedAt: new Date().toISOString() });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('email_formats')
        .updateOne({ siteId: validated.siteId, id: validated.id }, { $set: validated }, { upsert: true });
      return validated;
    }
    await mkdir(this.siteDir(validated.siteId), { recursive: true });
    await writeFile(this.filePath(validated.siteId, validated.id), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async delete(siteId: string, id: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('email_formats').deleteOne({ siteId, id });
      return;
    }
    await unlink(this.filePath(siteId, id)).catch(() => {});
  }

  /** Clears isDefault on siblings, sets it on the target. */
  async setDefault(siteId: string, id: string): Promise<void> {
    const all = await this.list(siteId);
    for (const format of all) {
      const shouldBeDefault = format.id === id;
      if (format.isDefault !== shouldBeDefault) {
        await this.save({ ...format, isDefault: shouldBeDefault });
      }
    }
  }
}

let storeInstance: EmailFormatStore | null = null;

export async function getEmailFormatStore(): Promise<EmailFormatStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new EmailFormatStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new EmailFormatStore();
  }
  return storeInstance;
}
