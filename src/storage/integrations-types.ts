export type IntegrationSecretKey =
  | 'openrouter_api_key'
  | 'anthropic_api_key'
  | 'firecrawl_api_key'
  | 'onpage_ai_api_key'
  | 'vercel_token'
  | 'originality_ai_api_key'
  | 'agent_media_api_key';

export type AiProvider = 'openrouter' | 'anthropic';

export interface WorkspaceIntegrationsStatus {
  openrouter: boolean;
  anthropic: boolean;
  firecrawl: boolean;
  onpage_ai: boolean;
  vercel: boolean;
  originality_ai: boolean;
  agent_media: boolean;
  defaultAiProvider: AiProvider | null;
  defaultAiModel: string | null;
  vercelTeamId: string | null;
  updatedAt: string | null;
}

export interface WorkspaceIntegrationsUpdate {
  openrouter_api_key?: string | null;
  anthropic_api_key?: string | null;
  firecrawl_api_key?: string | null;
  onpage_ai_api_key?: string | null;
  vercel_token?: string | null;
  originality_ai_api_key?: string | null;
  agent_media_api_key?: string | null;
  defaultAiProvider?: AiProvider | null;
  defaultAiModel?: string | null;
  vercelTeamId?: string | null;
}

export interface ResolvedAiKeys {
  provider: AiProvider;
  apiKey: string;
  model: string;
}
