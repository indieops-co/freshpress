import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import type { CampaignEnrollment, CampaignStep, EmailCampaign } from '../content/campaign-types.js';

export class CampaignStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'campaigns');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private campDir(siteId: string) {
    return join(this.dataDir, siteId, 'campaigns');
  }

  private stepDir(siteId: string) {
    return join(this.dataDir, siteId, 'steps');
  }

  private enrollDir(siteId: string) {
    return join(this.dataDir, siteId, 'enrollments');
  }

  async listCampaigns(siteId: string): Promise<EmailCampaign[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<EmailCampaign>('email_campaigns').find({ siteId }).toArray();
    }
    try {
      const files = await readdir(this.campDir(siteId));
      const out: EmailCampaign[] = [];
      for (const f of files) {
        if (f.endsWith('.json')) {
          out.push(JSON.parse(await readFile(join(this.campDir(siteId), f), 'utf-8')) as EmailCampaign);
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async getCampaign(siteId: string, campaignId: string): Promise<EmailCampaign | null> {
    const all = await this.listCampaigns(siteId);
    return all.find((c) => c.id === campaignId) ?? null;
  }

  async saveCampaign(campaign: EmailCampaign): Promise<EmailCampaign> {
    campaign.updatedAt = new Date().toISOString();
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('email_campaigns').updateOne(
        { siteId: campaign.siteId, id: campaign.id },
        { $set: campaign },
        { upsert: true }
      );
      return campaign;
    }
    const dir = this.campDir(campaign.siteId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${campaign.id}.json`), JSON.stringify(campaign, null, 2), 'utf-8');
    return campaign;
  }

  async createCampaign(
    siteId: string,
    data: Pick<EmailCampaign, 'audience' | 'pillarId' | 'keyword' | 'name'>
  ): Promise<EmailCampaign> {
    const now = new Date().toISOString();
    const campaign: EmailCampaign = {
      id: nanoid(12),
      siteId,
      // Only the keys that apply: Mongo would store an undefined value as null.
      ...(data.audience !== undefined ? { audience: data.audience } : {}),
      ...(data.pillarId !== undefined ? { pillarId: data.pillarId } : {}),
      ...(data.keyword !== undefined ? { keyword: data.keyword } : {}),
      name: data.name,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    return this.saveCampaign(campaign);
  }

  async listSteps(siteId: string, campaignId: string): Promise<CampaignStep[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db
        .collection<CampaignStep>('campaign_steps')
        .find({ siteId, campaignId })
        .sort({ order: 1 })
        .toArray();
    }
    try {
      const files = await readdir(this.stepDir(siteId));
      const out: CampaignStep[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const step = JSON.parse(await readFile(join(this.stepDir(siteId), f), 'utf-8')) as CampaignStep;
        if (step.campaignId === campaignId) out.push(step);
      }
      return out.sort((a, b) => a.order - b.order);
    } catch {
      return [];
    }
  }

  async saveSteps(siteId: string, campaignId: string, steps: CampaignStep[]): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('campaign_steps').deleteMany({ siteId, campaignId });
      if (steps.length) await db.collection('campaign_steps').insertMany(steps);
      return;
    }
    const dir = this.stepDir(siteId);
    await mkdir(dir, { recursive: true });
    const existing = await this.listSteps(siteId, campaignId);
    for (const s of existing) {
      await rm(join(dir, `${s.id}.json`), { force: true });
    }
    for (const step of steps) {
      await writeFile(join(dir, `${step.id}.json`), JSON.stringify(step, null, 2), 'utf-8');
    }
  }

  async listEnrollments(siteId: string, campaignId?: string): Promise<CampaignEnrollment[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db
        .collection<CampaignEnrollment>('campaign_enrollments')
        .find({ siteId, ...(campaignId ? { campaignId } : {}) })
        .toArray();
    }
    let files: string[];
    try {
      files = await readdir(this.enrollDir(siteId));
    } catch {
      return [];
    }
    const out: CampaignEnrollment[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      let e: CampaignEnrollment;
      try {
        e = JSON.parse(await readFile(join(this.enrollDir(siteId), f), 'utf-8')) as CampaignEnrollment;
      } catch {
        // A half-written (or concurrently created) file skips only itself, not the whole site.
        console.error(`Skipping unreadable enrollment file ${siteId}/${f}`);
        continue;
      }
      if (!campaignId || e.campaignId === campaignId) out.push(e);
    }
    return out;
  }

  async getEnrollmentById(siteId: string, enrollmentId: string): Promise<CampaignEnrollment | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<CampaignEnrollment>('campaign_enrollments').findOne({ siteId, id: enrollmentId });
    }
    try {
      return JSON.parse(
        await readFile(join(this.enrollDir(siteId), `${enrollmentId}.json`), 'utf-8')
      ) as CampaignEnrollment;
    } catch {
      return null;
    }
  }

  async getEnrollment(siteId: string, campaignId: string, subscriberId: string): Promise<CampaignEnrollment | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<CampaignEnrollment>('campaign_enrollments').findOne({ siteId, campaignId, subscriberId });
    }
    const all = await this.listEnrollments(siteId, campaignId);
    return all.find((e) => e.subscriberId === subscriberId) ?? null;
  }

  async saveEnrollment(enrollment: CampaignEnrollment): Promise<CampaignEnrollment> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      // replaceOne (not $set) so keys the engine drops — nextSendAt on completion — actually go away.
      await db
        .collection<CampaignEnrollment>('campaign_enrollments')
        .replaceOne({ siteId: enrollment.siteId, id: enrollment.id }, enrollment, { upsert: true });
      return enrollment;
    }
    const dir = this.enrollDir(enrollment.siteId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${enrollment.id}.json`), JSON.stringify(enrollment, null, 2), 'utf-8');
    return enrollment;
  }

  /**
   * Create-only-if-absent: returns false (writing nothing) when an enrollment with this id already
   * exists. With deterministic ids this is what makes concurrent enroll calls produce one record.
   */
  async createEnrollmentIfAbsent(enrollment: CampaignEnrollment): Promise<boolean> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      try {
        // _id = the enrollment id, so Mongo's always-unique _id index rejects a second insert.
        await db
          .collection<CampaignEnrollment & { _id: string }>('campaign_enrollments')
          .insertOne({ _id: enrollment.id, ...enrollment });
        return true;
      } catch (err) {
        if ((err as { code?: unknown }).code === 11000) return false; // duplicate key — already enrolled
        throw err;
      }
    }
    const dir = this.enrollDir(enrollment.siteId);
    await mkdir(dir, { recursive: true });
    try {
      // 'wx' = exclusive create: fails with EEXIST if the file already exists.
      await writeFile(join(dir, `${enrollment.id}.json`), JSON.stringify(enrollment, null, 2), {
        encoding: 'utf-8',
        flag: 'wx',
      });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  /** Cross-site: every active enrollment whose next step is due — the scheduler's work queue. */
  async listDueEnrollments(nowIso: string): Promise<CampaignEnrollment[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db
        .collection<CampaignEnrollment>('campaign_enrollments')
        .find({ status: 'active', nextSendAt: { $lte: nowIso } })
        .toArray();
    }
    try {
      const siteIds = await readdir(this.dataDir);
      const due: CampaignEnrollment[] = [];
      for (const siteId of siteIds) {
        const enrollments = await this.listEnrollments(siteId);
        due.push(...enrollments.filter((e) => e.status === 'active' && e.nextSendAt && e.nextSendAt <= nowIso));
      }
      return due;
    } catch {
      return [];
    }
  }
}

let storeInstance: CampaignStore | null = null;

export async function getCampaignStore(): Promise<CampaignStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new CampaignStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new CampaignStore();
  }
  return storeInstance;
}
