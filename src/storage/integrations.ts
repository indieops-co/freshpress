import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from 'mongodb';
import { encryptSecret, decryptSecret } from '../crypto/vault.js';
import type {
  IntegrationSecretKey,
  WorkspaceIntegrationsStatus,
  WorkspaceIntegrationsUpdate,
  AiProvider,
} from './integrations-types.js';

interface StoredIntegrations {
  secrets: Partial<Record<IntegrationSecretKey, string>>;
  defaultAiProvider: AiProvider | null;
  defaultAiModel: string | null;
  vercelTeamId: string | null;
  updatedAt: string | null;
}

const SECRET_KEYS: IntegrationSecretKey[] = [
  'openrouter_api_key',
  'anthropic_api_key',
  'firecrawl_api_key',
  'onpage_ai_api_key',
  'vercel_token',
  'originality_ai_api_key',
  'agent_media_api_key',
];

const EMPTY: StoredIntegrations = {
  secrets: {},
  defaultAiProvider: null,
  defaultAiModel: null,
  vercelTeamId: null,
  updatedAt: null,
};

function toStatus(data: StoredIntegrations): WorkspaceIntegrationsStatus {
  return {
    openrouter: !!data.secrets.openrouter_api_key,
    anthropic: !!data.secrets.anthropic_api_key,
    firecrawl: !!data.secrets.firecrawl_api_key || !!process.env.FIRECRAWL_API_KEY,
    onpage_ai: !!data.secrets.onpage_ai_api_key,
    vercel: !!data.secrets.vercel_token,
    originality_ai: !!data.secrets.originality_ai_api_key,
    agent_media: !!data.secrets.agent_media_api_key,
    defaultAiProvider: data.defaultAiProvider,
    defaultAiModel: data.defaultAiModel,
    vercelTeamId: data.vercelTeamId,
    updatedAt: data.updatedAt,
  };
}

export class IntegrationsStore {
  private dataDir: string;
  private dbPromise: Promise<Db> | null;

  constructor(options?: { dataDir?: string; dbPromise?: Promise<Db> }) {
    const root = options?.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), 'data');
    this.dataDir = join(root, 'workspace');
    this.dbPromise = options?.dbPromise ?? null;
  }

  private async readFs(): Promise<StoredIntegrations> {
    const path = join(this.dataDir, 'integrations.json');
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as StoredIntegrations;
    } catch {
      return { ...EMPTY, secrets: {} };
    }
  }

  private async writeFs(data: StoredIntegrations): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(join(this.dataDir, 'integrations.json'), JSON.stringify(data, null, 2), 'utf-8');
  }

  private async readMongo(): Promise<StoredIntegrations> {
    const db = await this.dbPromise!;
    const doc = await db.collection<StoredIntegrations>('workspace_integrations').findOne({ id: 'default' });
    return doc ?? { ...EMPTY, secrets: {} };
  }

  private async writeMongo(data: StoredIntegrations): Promise<void> {
    const db = await this.dbPromise!;
    await db.collection('workspace_integrations').updateOne(
      { id: 'default' },
      { $set: { ...data, id: 'default' } },
      { upsert: true }
    );
  }

  private async read(): Promise<StoredIntegrations> {
    if (this.dbPromise) return this.readMongo();
    return this.readFs();
  }

  private async write(data: StoredIntegrations): Promise<void> {
    if (this.dbPromise) return this.writeMongo(data);
    return this.writeFs(data);
  }

  async getStatus(): Promise<WorkspaceIntegrationsStatus> {
    return toStatus(await this.read());
  }

  async update(patch: WorkspaceIntegrationsUpdate): Promise<WorkspaceIntegrationsStatus> {
    const data = await this.read();

    for (const key of SECRET_KEYS) {
      if (key in patch) {
        const value = patch[key];
        if (value === null || value === '') {
          delete data.secrets[key];
        } else if (typeof value === 'string') {
          data.secrets[key] = encryptSecret(value);
        }
      }
    }

    if ('defaultAiProvider' in patch) data.defaultAiProvider = patch.defaultAiProvider ?? null;
    if ('defaultAiModel' in patch) data.defaultAiModel = patch.defaultAiModel ?? null;
    if ('vercelTeamId' in patch) data.vercelTeamId = patch.vercelTeamId ?? null;

    data.updatedAt = new Date().toISOString();
    await this.write(data);
    return toStatus(data);
  }

  async getSecret(key: IntegrationSecretKey): Promise<string | null> {
    const data = await this.read();
    const encrypted = data.secrets[key];
    if (!encrypted) return null;
    try {
      return decryptSecret(encrypted);
    } catch {
      return null;
    }
  }

  async getDefaults(): Promise<Pick<StoredIntegrations, 'defaultAiProvider' | 'defaultAiModel' | 'vercelTeamId'>> {
    const data = await this.read();
    return {
      defaultAiProvider: data.defaultAiProvider,
      defaultAiModel: data.defaultAiModel,
      vercelTeamId: data.vercelTeamId,
    };
  }
}

let storeInstance: IntegrationsStore | null = null;

export async function getIntegrationsStore(): Promise<IntegrationsStore> {
  if (storeInstance) return storeInstance;

  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    const dbName = process.env.FRESHPRESS_DB_NAME || 'freshpress';
    const dbPromise = client.connect().then(() => client.db(dbName));
    storeInstance = new IntegrationsStore({ dbPromise });
  } else {
    storeInstance = new IntegrationsStore();
  }

  return storeInstance;
}
