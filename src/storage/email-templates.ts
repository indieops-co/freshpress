import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import { EmailTemplateSchema, type EmailTemplate } from '../design/email-template.js';

/** Many-per-site store (a site can have several named Templates), keyed by {siteId, id}. */
export class EmailTemplateStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'email-templates');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private siteDir(siteId: string) {
    return join(this.dataDir, siteId);
  }

  private filePath(siteId: string, id: string) {
    return join(this.siteDir(siteId), `${id}.json`);
  }

  async list(siteId: string): Promise<EmailTemplate[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const docs = await db.collection<EmailTemplate>('email_templates').find({ siteId }).toArray();
      return docs.map((d) => EmailTemplateSchema.parse(d));
    }
    try {
      const files = await readdir(this.siteDir(siteId));
      const out: EmailTemplate[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const raw = JSON.parse(await readFile(join(this.siteDir(siteId), f), 'utf-8'));
        out.push(EmailTemplateSchema.parse(raw));
      }
      return out;
    } catch {
      return [];
    }
  }

  async get(siteId: string, id: string): Promise<EmailTemplate | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<EmailTemplate>('email_templates').findOne({ siteId, id });
      return doc ? EmailTemplateSchema.parse(doc) : null;
    }
    try {
      const raw = JSON.parse(await readFile(this.filePath(siteId, id), 'utf-8'));
      return EmailTemplateSchema.parse(raw);
    } catch {
      return null;
    }
  }

  async save(template: EmailTemplate): Promise<EmailTemplate> {
    const validated = EmailTemplateSchema.parse({ ...template, updatedAt: new Date().toISOString() });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db
        .collection('email_templates')
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
      await db.collection('email_templates').deleteOne({ siteId, id });
      return;
    }
    await unlink(this.filePath(siteId, id)).catch(() => {});
  }

  async setDefault(siteId: string, id: string): Promise<void> {
    const all = await this.list(siteId);
    for (const template of all) {
      const shouldBeDefault = template.id === id;
      if (template.isDefault !== shouldBeDefault) {
        await this.save({ ...template, isDefault: shouldBeDefault });
      }
    }
  }
}

let storeInstance: EmailTemplateStore | null = null;

export async function getEmailTemplateStore(): Promise<EmailTemplateStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new EmailTemplateStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new EmailTemplateStore();
  }
  return storeInstance;
}
