import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import {
  WorkspaceSchema,
  WorkspaceUserSchema,
  SessionSchema,
  type Workspace,
  type WorkspaceUser,
  type Session,
  type UserPreferences,
  type UserPermissions,
  type PlanTier,
} from '../auth/types.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class WorkspaceUsersStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'workspace');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private workspacePath() {
    return join(this.dataDir, 'workspace.json');
  }

  private userPath(userId: string) {
    return join(this.dataDir, 'users', `${userId}.json`);
  }

  private sessionPath(tokenHash: string) {
    return join(this.dataDir, 'sessions', `${tokenHash}.json`);
  }

  async getWorkspace(): Promise<Workspace | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<Workspace>('workspaces').findOne({});
      return doc ? WorkspaceSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.workspacePath(), 'utf-8');
      return WorkspaceSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveWorkspace(workspace: Workspace): Promise<Workspace> {
    const validated = WorkspaceSchema.parse({
      ...workspace,
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('workspaces').updateOne(
        { id: validated.id },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.workspacePath(), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async createWorkspace(name: string, planTier: PlanTier = 'free'): Promise<Workspace> {
    const now = new Date().toISOString();
    return this.saveWorkspace({
      id: nanoid(12),
      name,
      planTier,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Set the (single) workspace's plan tier — the write side of the license gate.
   * Called by the paid overlay's `activate()` after a LemonSqueezy validation; a plain
   * write, so it is idempotent and safe to re-run on every boot. Core-resident so the
   * overlay stays thin; harmless in the free build, where nothing calls it.
   */
  async setPlanTier(tier: PlanTier): Promise<Workspace> {
    const ws = (await this.getWorkspace()) ?? (await this.createWorkspace('Workspace'));
    return this.saveWorkspace({ ...ws, planTier: tier }); // one workspace per instance
  }

  async getUserById(userId: string): Promise<WorkspaceUser | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<WorkspaceUser>('workspace_users').findOne({ id: userId });
      return doc ? WorkspaceUserSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.userPath(userId), 'utf-8');
      return WorkspaceUserSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async getUserByEmail(email: string): Promise<WorkspaceUser | null> {
    const normalized = email.trim().toLowerCase();
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<WorkspaceUser>('workspace_users').findOne({ email: normalized });
      return doc ? WorkspaceUserSchema.parse(doc) : null;
    }
    try {
      const files = await readdir(join(this.dataDir, 'users'));
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const user = WorkspaceUserSchema.parse(
          JSON.parse(await readFile(join(this.dataDir, 'users', f), 'utf-8'))
        );
        if (user.email === normalized) return user;
      }
    } catch {
      /* no users yet */
    }
    return null;
  }

  async listUsers(): Promise<WorkspaceUser[]> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      return db.collection<WorkspaceUser>('workspace_users').find({}).toArray();
    }
    try {
      const files = await readdir(join(this.dataDir, 'users'));
      const out: WorkspaceUser[] = [];
      for (const f of files) {
        if (f.endsWith('.json')) {
          out.push(
            WorkspaceUserSchema.parse(
              JSON.parse(await readFile(join(this.dataDir, 'users', f), 'utf-8'))
            )
          );
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async saveUser(user: WorkspaceUser): Promise<WorkspaceUser> {
    const validated = WorkspaceUserSchema.parse({
      ...user,
      email: user.email.trim().toLowerCase(),
      updatedAt: new Date().toISOString(),
    });
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('workspace_users').updateOne(
        { id: validated.id },
        { $set: validated },
        { upsert: true }
      );
      return validated;
    }
    await mkdir(join(this.dataDir, 'users'), { recursive: true });
    await writeFile(this.userPath(validated.id), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  async createUser(data: {
    workspaceId: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: WorkspaceUser['role'];
    preferences?: UserPreferences;
    permissions?: UserPermissions;
  }): Promise<WorkspaceUser> {
    const now = new Date().toISOString();
    return this.saveUser({
      id: nanoid(12),
      workspaceId: data.workspaceId,
      email: data.email.trim().toLowerCase(),
      passwordHash: data.passwordHash,
      displayName: data.displayName,
      role: data.role,
      preferences: data.preferences ?? {},
      permissions: data.permissions ?? { canPublish: true },
      createdAt: now,
      updatedAt: now,
    });
  }

  async deleteUser(userId: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('workspace_users').deleteOne({ id: userId });
      return;
    }
    await rm(this.userPath(userId), { force: true });
  }

  async updateUserPreferences(userId: string, prefs: Partial<UserPreferences>): Promise<WorkspaceUser | null> {
    const user = await this.getUserById(userId);
    if (!user) return null;
    return this.saveUser({
      ...user,
      preferences: { ...user.preferences, ...prefs },
    });
  }

  async createSession(userId: string, workspaceId: string): Promise<{ token: string; session: Session }> {
    const token = nanoid(32);
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const session: Session = {
      tokenHash,
      userId,
      workspaceId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };
    await this.saveSession(session);
    return { token, session };
  }

  async saveSession(session: Session): Promise<void> {
    const validated = SessionSchema.parse(session);
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('sessions').updateOne(
        { tokenHash: validated.tokenHash },
        { $set: validated },
        { upsert: true }
      );
      return;
    }
    await mkdir(join(this.dataDir, 'sessions'), { recursive: true });
    await writeFile(this.sessionPath(validated.tokenHash), JSON.stringify(validated, null, 2), 'utf-8');
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      const doc = await db.collection<Session>('sessions').findOne({ tokenHash });
      return doc ? SessionSchema.parse(doc) : null;
    }
    try {
      const raw = await readFile(this.sessionPath(tokenHash), 'utf-8');
      return SessionSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.collection('sessions').deleteOne({ tokenHash });
      return;
    }
    await rm(this.sessionPath(tokenHash), { force: true });
  }
}

let storeInstance: WorkspaceUsersStore | null = null;

export async function getWorkspaceUsersStore(): Promise<WorkspaceUsersStore> {
  if (storeInstance) return storeInstance;
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    storeInstance = new WorkspaceUsersStore({ dbPromise: client.connect().then(() => client.db(dbName)) });
  } else {
    storeInstance = new WorkspaceUsersStore();
  }
  return storeInstance;
}
