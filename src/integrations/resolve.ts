import { getIntegrationsStore } from '../storage/integrations.js';
import type { ResolvedAiKeys } from '../storage/integrations-types.js';

/** Resolve Vercel deploy credentials: vault first, then env. */
export async function resolveVercelCredentials(): Promise<{
  token: string | null;
  teamId: string | null;
}> {
  const store = await getIntegrationsStore();
  const token = (await store.getSecret('vercel_token')) ?? process.env.VERCEL_TOKEN ?? null;
  const defaults = await store.getDefaults();
  const teamId = defaults.vercelTeamId ?? process.env.VERCEL_TEAM_ID ?? null;
  return { token, teamId };
}

/** Resolve AI provider keys: vault first, then env. */
export async function resolveAiKeys(): Promise<ResolvedAiKeys | null> {
  const store = await getIntegrationsStore();
  const defaults = await store.getDefaults();

  const openrouter = (await store.getSecret('openrouter_api_key')) ?? process.env.OPENROUTER_API_KEY ?? null;
  const anthropic = (await store.getSecret('anthropic_api_key')) ?? process.env.ANTHROPIC_API_KEY ?? null;

  const preferred = defaults.defaultAiProvider;
  if (preferred === 'openrouter' && openrouter) {
    return {
      provider: 'openrouter',
      apiKey: openrouter,
      model: defaults.defaultAiModel ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4',
    };
  }
  if (preferred === 'anthropic' && anthropic) {
    return {
      provider: 'anthropic',
      apiKey: anthropic,
      model: defaults.defaultAiModel ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    };
  }

  if (anthropic) {
    return {
      provider: 'anthropic',
      apiKey: anthropic,
      model: defaults.defaultAiModel ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    };
  }
  if (openrouter) {
    return {
      provider: 'openrouter',
      apiKey: openrouter,
      model: defaults.defaultAiModel ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4',
    };
  }

  return null;
}

const SECRET_ENV_FALLBACKS: Partial<Record<string, string>> = {
  firecrawl_api_key: 'FIRECRAWL_API_KEY',
  onpage_ai_api_key: 'ONPAGE_AI_API_KEY',
  originality_ai_api_key: 'ORIGINALITY_AI_API_KEY',
};

/** Resolve a secret: vault (user BYOK) first, then env (owner default). */
export async function resolveSecret(
  key: 'firecrawl_api_key' | 'onpage_ai_api_key' | 'originality_ai_api_key'
): Promise<string | null> {
  const store = await getIntegrationsStore();
  const fromVault = await store.getSecret(key);
  if (fromVault) return fromVault;
  const envName = SECRET_ENV_FALLBACKS[key];
  return (envName && process.env[envName]) || null;
}

export async function resolveAgentMediaKey(): Promise<string | null> {
  const store = await getIntegrationsStore();
  return (await store.getSecret('agent_media_api_key')) ?? process.env.AGENT_MEDIA_API_KEY ?? null;
}
