import type {
  Site,
  SiteMeta,
  SiteReviewState,
  SitePage,
  SiteVersion,
  SlotChange,
  ContentSlot,
  ContainerNode,
  NamedElement,
  PageContent,
} from './types';

export type { Site, SiteMeta, SiteReviewState, SitePage, SiteVersion, SlotChange, ContentSlot, ContainerNode, NamedElement, PageContent };

/** Outbound email providers a site can connect — mirrors the server's EmailProviderId. */
export type EmailProviderId = 'resend' | 'sendgrid' | 'postmark' | 'smtp';

/** Site email settings as GET/PUT /email return them — secrets only ever masked. */
export interface SiteEmailSettings {
  enabled: boolean;
  provider?: EmailProviderId;
  fromEmail?: string;
  fromName?: string;
  notifyEmail?: string;
  successMessage?: string;
  /** Whether the ACTIVE provider has its credentials saved. */
  hasApiKey?: boolean;
  apiKeyPreview?: string;
  smtp?: { host?: string; port?: number; secure?: boolean; username?: string; hasPassword?: boolean };
}

/** PUT /email body — omitted fields keep their saved values. */
export interface SiteEmailSettingsUpdate {
  provider?: EmailProviderId;
  resendApiKey?: string;
  apiKey?: string;
  smtp?: { host?: string; port?: number; secure?: boolean; username?: string; password?: string };
  fromEmail?: string;
  fromName?: string;
  notifyEmail?: string;
  successMessage?: string;
  enabled?: boolean;
}

export interface ImportPreview {
  siteName: string;
  siteUrl?: string;
  suggestedDomain?: string;
  counts: {
    authors: number;
    categories: number;
    tags: number;
    attachments: number;
    articles: number;
    comments: number;
    sitePages: number;
    mediaFailed: number;
  };
  authors: Array<{ login: string; displayName: string; email: string }>;
  pages: Array<{ slug: string; title: string; wpPostId: number }>;
}

export interface ImportJob {
  id: string;
  siteId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  currentStep?: string;
  errors: string[];
  stats: ImportPreview['counts'];
  createdAt: string;
  updatedAt: string;
}

export interface EmailFormatProvenance {
  source: 'style-guide-sync' | 'manual' | 'imported';
  sourceRef?: string;
  sourceSiteId?: string;
  syncedAt?: string;
  customized: boolean;
}

export interface EmailFormat {
  id: string;
  siteId: string;
  name: string;
  isDefault: boolean;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    textInverse: string;
    border: string;
    linkColor: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: string;
    bodyWeight: string;
    h1Size: string;
    h2Size: string;
    bodySize: string;
    smallSize: string;
    lineHeight: string;
  };
  spacing: {
    gutter: string;
    sectionGap: string;
    paragraphGap: string;
    buttonPaddingY: string;
    buttonPaddingX: string;
  };
  button: { background: string; textColor: string; radius: string; fontWeight: string };
  provenance: EmailFormatProvenance;
  visibility: 'private' | 'workspace';
  createdAt: string;
  updatedAt: string;
}

export type EmailBlockKind =
  | 'header-logo'
  | 'heading'
  | 'body'
  | 'cta-button'
  | 'divider'
  | 'signature-slot'
  | 'footer';

export interface EmailBlock {
  id: string;
  kind: EmailBlockKind;
  required: boolean;
  config: Record<string, unknown>;
}

export interface EmailTemplate {
  id: string;
  siteId: string;
  name: string;
  isDefault: boolean;
  blocks: EmailBlock[];
  maxWidth: string;
  visibility: 'private' | 'workspace';
  createdAt: string;
  updatedAt: string;
}

export interface SiteSignatureConfig {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  extraHtml?: string;
}

export interface SiteEmailBrandDefaults {
  activeFormatId?: string;
  activeTemplateId?: string;
  includeBrandDefault: boolean;
  includeSignatureDefault: boolean;
  signature?: SiteSignatureConfig;
}

/** Never includes the raw webhook signing secret — hasWebhookSecret is a presence flag only. */
export interface InboundEmailConfig {
  enabled: boolean;
  domainChoice: 'root' | 'subdomain';
  domain?: string;
  resendDomainId?: string;
  verified: boolean;
  hasWebhookSecret: boolean;
}

export interface InboundDomainRecord {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
  priority?: number;
}

export type EmailFolderFilterMatchType = 'keyword' | 'senderDomain';

export interface EmailFolderFilterRule {
  matchType: EmailFolderFilterMatchType;
  value: string;
}

export interface EmailFolder {
  id: string;
  siteId: string;
  name: string;
  kind: 'system' | 'custom';
  systemType?: 'inbox' | 'drafts' | 'sent';
  order: number;
  color?: string;
  parentFolderId?: string;
  filterRule?: EmailFolderFilterRule;
  createdAt: string;
  updatedAt: string;
}

export interface EmailThread {
  id: string;
  siteId: string;
  folderId: string;
  subject: string;
  participantEmails: string[];
  lastMessageAt: string;
  messageCount: number;
  isRead: boolean;
  snippet: string;
  category?: 'personal' | 'promo' | 'newsletter';
  createdAt: string;
  updatedAt: string;
}

export interface EmailInboxMessage {
  id: string;
  siteId: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  status: 'draft' | 'scheduled' | 'sent' | 'received';
  from: string;
  to: string[];
  subject: string;
  bodyHtml: string;
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  isAiGenerated?: boolean;
  scheduledAt?: string;
  /** Render-time ingredients persisted when status becomes 'scheduled' — read back unchanged by the scheduler. */
  formatId?: string;
  templateId?: string;
  includeBrand?: boolean;
  includeSignature?: boolean;
  plainTextOnly?: boolean;
  gutterOverride?: string;
  sentAt: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailInboxDashboard {
  stats: {
    unread: number;
    scheduled: number;
    drafts: number;
    sentToday: number;
    recentReplies: number;
  };
  kanban: {
    draft: EmailInboxMessage[];
    scheduled: { day: string; messages: EmailInboxMessage[] }[];
    sent: EmailInboxMessage[];
  };
  folders: { inboxId: string; draftsId: string; sentId: string };
}

/** Shared body shape for reply/compose/edit-draft sends — mirrors BrandComposeControls' state. */
export interface EmailComposeSendBody {
  bodyHtml: string;
  formatId?: string;
  templateId?: string;
  includeBrand?: boolean;
  includeSignature?: boolean;
  plainTextOnly?: boolean;
  gutterOverride?: string;
  send?: boolean;
  /** string to (re)schedule, null (PATCH only) to unschedule back to a plain draft — takes precedence over `send`. */
  scheduledAt?: string | null;
}

export interface MediaAsset {
  id: string;
  filename: string;
  publicPath: string;
  relativePath: string;
  mimeType?: string;
  sourceUrl?: string;
  wpPostId?: number;
  createdAt: string;
}

export interface BlogPost {
  id: string;
  siteId: string;
  pillarId: string;
  kind: 'pillar' | 'supportive';
  title: string;
  slug: string;
  keyword: string;
  bodyHtml: string;
  status: 'draft' | 'published' | 'scheduled';
  metaTitle?: string;
  metaDescription?: string;
  order: number;
  publishedAt?: string;
  socialGenerationMeta?: { runCount: number; usedSections: string[] };
  createdAt: string;
  updatedAt: string;
}

export interface BlogPillar {
  id: string;
  siteId: string;
  keyword: string;
  slug: string;
  title: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlogSilo {
  pillar: BlogPillar;
  posts: BlogPost[];
}

export type HumanizerMode = 'simple' | 'skill';

export interface HumanizerReviewScore {
  score: number;
  note: string;
}

export interface HumanizerReview {
  contentType: string;
  assessment: string;
  scores: Record<string, HumanizerReviewScore>;
  patternFlags: Array<{ quote: string; suggestion: string }>;
  topChanges: string[];
}

export interface HumanizeResult {
  humanizedHtml: string;
  mode: HumanizerMode;
  review?: HumanizerReview;
}

export interface WritingSample {
  id: string;
  text: string;
  addedAt: string;
}

/** Evolvable writing skill — samples added incrementally over time, plus "never say/do" constraints. Shared by email replies and brand voice. */
export interface WritingSkill {
  samples: WritingSample[];
  neverPhrases: string[];
}
/** @deprecated alias kept for existing call sites — use WritingSkill. */
export type EmailReplySkill = WritingSkill;

export interface HumanizerSiteConfig {
  siteId: string;
  mode: HumanizerMode;
  tone: string;
  readingLevel: string;
  voiceSample?: string;
  customAugment?: string;
  contentTypeHint?: 'blog' | 'email' | 'auto';
  emailReplySkill?: WritingSkill;
  /** Brand voice & tone skill (Site Theme page, Chunk 6). */
  brandVoiceSkill?: WritingSkill;
  autoDraftEnabled?: boolean;
  updatedAt: string;
}

export interface TypographyToken {
  size: string;
  weight: string;
  lineHeight: string;
  tracking: string;
  transform?: string;
}

/** The full site StyleGuide as returned by the design routes (Site Theme page reads this). */
export interface SiteStyleGuide {
  meta: { id: string; name: string; aesthetic: string; designPhilosophy: string; source: string };
  colors: Record<string, string | Record<string, string>>;
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont: string;
    scale: Record<string, TypographyToken>;
  };
  spacing: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
  components: Record<string, Record<string, unknown>>;
  motion: Record<string, unknown>;
  customCss?: string;
  cssVariables?: string;
}

/**
 * The design-route payload slice the theme-preview surfaces render (a subset
 * of the server StyleGuide). Lives here because it describes API responses;
 * ThemePreview re-exports it for component-side use.
 */
export interface StyleGuidePreview {
  meta: { name: string; aesthetic: string; designPhilosophy: string };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
  };
  typography: { headingFont: string; bodyFont: string };
  components: {
    button: { primaryBg: string; primaryText: string; primaryRadius: string };
    card: { background: string; border: string; radius: string; shadow: string };
  };
}

/** A reviewable brand draft from Amendment F's URL extractor (mirrors server ExtractedBrand). */
export interface ExtractedBrand {
  colors: Partial<Record<'primary' | 'secondary' | 'accent' | 'background' | 'surface' | 'text' | 'textMuted' | 'border', string>>;
  typography: Partial<Record<'headingFont' | 'bodyFont' | 'monoFont', string>>;
  radii: { md?: string };
  shadows: { md?: string };
  logoUrl?: string;
  confidence: { colors: number; typography: number; radii: number; shadows: number; logo: number };
  engine: 'firecrawl' | 'heuristic';
  sourceUrl: string;
}

/** Design Powerpack critique on a generated direction (mirrors server DirectionCritique). */
export interface DirectionCritique {
  /** 1–10, higher = reads more like generic AI output (1 is the goal). */
  slopScore: number;
  verdict: string;
  issues: string[];
}

/** One generated home-page direction from POST /sites/:siteId/generate (mirrors server GeneratedDirection). */
export interface GeneratedDirection {
  index: number;
  scaffoldId: string;
  scaffoldName: string;
  directive: string;
  fingerprint: string[];
  valid: boolean;
  errors: string[];
  page: { path: string; title: string; content: PageContent };
  /** Full themed HTML for the picker's live iframe preview. */
  previewHtml?: string;
  critique?: DirectionCritique;
}

/** Intake for POST /sites/:siteId/generate (page directions — distinct from the design intake). */
export interface SiteDirectionsIntake {
  brandName: string;
  industry?: string;
  personality: string[];
  targetAudience?: string;
  moodKeywords?: string[];
  count?: number;
  critique?: boolean;
  /** Opt in to the newsletter-signup section (server also requires the emailSystem feature). */
  includeSignup?: boolean;
}

/** One editable StyleGuide field, mirroring the server whitelist (validate-style-guide.ts). */
export interface EditableFieldKind {
  kind: 'css-value' | 'color' | 'shadow' | 'font' | 'text' | 'number' | 'enum' | 'site-css';
  values?: string[];
  max?: number;
}
export interface EditableField {
  path: string;
  kind: EditableFieldKind;
  current: unknown;
}

/** Absent on campaigns created before welcome campaigns existed = 'pillar'. */
export type CampaignAudience = 'pillar' | 'welcome';

export interface CampaignStep {
  id: string;
  subject: string;
  previewText: string;
  bodyHtml: string;
  delayDays: number;
  order: number;
  formatId?: string;
  templateId?: string;
  includeBrand?: boolean;
  includeSignature?: boolean;
}

export interface HumanizeRequestOptions {
  mode?: HumanizerMode;
  includeReview?: boolean;
  html?: string;
  contentType?: 'blog' | 'email' | 'social' | 'auto';
}

export interface PublishRecord {
  id: string;
  siteId: string;
  label: string;
  createdAt: string;
  pageCount: number;
  prePublishVersionId?: string;
  deploymentUrl?: string;
  vercelDeploymentId?: string;
}


// ── Deep Brand Research (opt-in wizard) ──────────────────────────────────────

/** Mirror of the backend VOICE_SUMMARY_MAX_CHARS (content/brand-research-types.ts). */
export const VOICE_SUMMARY_MAX_CHARS = 1500;

export type BrandResearchStep =
  | 'research'
  | 'avatar'
  | 'offerBrief'
  | 'beliefs'
  | 'interviews'
  | 'voiceSummary';

export interface BrandDocMeta {
  generatedAt: string;
  model?: string;
  approved: boolean;
  userEdited: boolean;
  stale: boolean;
}

export interface BrandResearchDoc extends BrandDocMeta {
  markdown: string;
  productSummary: string;
  marketInsights: string[];
  competitorNotes: string[];
  customerLanguage: string[];
  provenAngles: string[];
}

export interface BrandAvatarDoc extends BrandDocMeta {
  name: string;
  demographics: string;
  psychographics: string;
  painPoints: string[];
  desires: string[];
  objections: string[];
  triggers: string[];
  quotes: string[];
}

export interface BrandOfferBriefDoc extends BrandDocMeta {
  uniqueMechanism: string;
  positioning: string;
  usps: string[];
  guarantees: string[];
  pricingFrame: string;
  differentiation: string[];
}

export interface BrandBelief {
  statement: string;
  currentBelief: string;
  shiftStrategy: string;
}

export interface BrandBeliefsDoc extends BrandDocMeta {
  beliefs: BrandBelief[];
}

export interface InterviewAnswers {
  discoveryChannel: string;
  painPoint: string;
  trigger: string;
  alternatives: string;
  objections: string;
  conversionTrigger: string;
  desiredOutcome: string;
  usagePlan: string;
  customerQuote: string;
}

export interface InterviewCustomer {
  name: string;
  context: string;
  answers: InterviewAnswers;
}

export interface InterviewCluster {
  label: string;
  avatarType: string;
  members: string[];
  themes: string[];
}

export interface BrandInterviewsDoc extends BrandDocMeta {
  customers: InterviewCustomer[];
  clusters: InterviewCluster[];
}

export interface BrandVoiceSummaryDoc extends BrandDocMeta {
  summary: string;
}

export interface BrandResearchDocsMap {
  research?: BrandResearchDoc;
  avatar?: BrandAvatarDoc;
  offerBrief?: BrandOfferBriefDoc;
  beliefs?: BrandBeliefsDoc;
  interviews?: BrandInterviewsDoc;
  voiceSummary?: BrandVoiceSummaryDoc;
}

export interface TranscriptInput {
  id: string;
  label: string;
  text: string;
  addedAt: string;
}

export interface BrandResearchInputs {
  productDescription: string;
  competitorUrls: string[];
  transcripts: TranscriptInput[];
}

export interface BrandResearch {
  siteId: string;
  enabled: boolean;
  inputs: BrandResearchInputs;
  docs: BrandResearchDocsMap;
  updatedAt: string;
}

export interface BrandResearchPatchBody {
  enabled?: boolean;
  inputs?: Partial<BrandResearchInputs>;
  docs?: Partial<BrandResearchDocsMap>;
}

export type SocialPlatform = 'linkedin' | 'x' | 'instagram' | 'facebook';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  label: string;
  profileUrl?: string;
  included: boolean;
}

export interface SocialSiteConfig {
  siteId: string;
  accounts: SocialAccount[];
  autoGenerateOnPublish: boolean;
  defaultFullScreenCards: boolean;
  updatedAt: string;
}

export interface SocialVariant {
  id: string;
  platform: SocialPlatform;
  variantIndex: 1 | 2;
  bodyText: string;
  suggestedTags: string[];
  images: {
    hero?: { url: string };
    textCardLight?: { url: string };
    textCardDark?: { url: string };
  };
}

export interface SocialGenerationBatch {
  id: string;
  siteId: string;
  sourcePostId: string;
  generationRun: number;
  sourceSection: string;
  targetKeywords: string[];
  status: string;
  variants: SocialVariant[];
  createdAt: string;
}

export interface SocialPostDraft {
  id: string;
  siteId: string;
  sourcePostId: string;
  batchId: string;
  platform: SocialPlatform;
  accountId: string;
  bodyText: string;
  tags: string[];
  status: 'draft' | 'published';
  targetKeywords: string[];
  sourceSection: string;
  generationRun: number;
  images: {
    hero?: string;
    textCardLight?: string;
    textCardDark?: string;
  };
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const TOKEN_KEY = 'freshpress_token';
const CLIENT_SITE_KEY = 'freshpress_client_site';
const LEGACY_TOKEN_KEYS = ['presspal_token', 'claudepress_token'] as const;

export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) return token;
  for (const legacyKey of LEGACY_TOKEN_KEYS) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      localStorage.removeItem(legacyKey);
      return legacy;
    }
  }
  return null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  for (const legacyKey of LEGACY_TOKEN_KEYS) {
    localStorage.removeItem(legacyKey);
  }
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CLIENT_SITE_KEY);
  for (const legacyKey of LEGACY_TOKEN_KEYS) {
    localStorage.removeItem(legacyKey);
  }
}

export function getClientSiteId(): string | null {
  return localStorage.getItem(CLIENT_SITE_KEY);
}

export function setClientSiteId(siteId: string | null): void {
  if (siteId) localStorage.setItem(CLIENT_SITE_KEY, siteId);
  else localStorage.removeItem(CLIENT_SITE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const detail = [body.guardianErrors, body.violations, body.missing, body.details]
      .find((d: unknown): d is string[] => Array.isArray(d) && d.every((x) => typeof x === 'string'));
    const message = body.error ?? `Request failed: ${res.status}`;
    throw new Error(detail?.length ? `${message} (${detail.join('; ')})` : message);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json();
  return res.text() as unknown as T;
}

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  permissions: { canPublish: boolean };
  createdAt: string;
  updatedAt: string;
}

/** Latest WordPress-reported sync summary (Phase 3, Chunk 6). Counts are snake_case to match the plugin. */
export interface ConnectorSyncReport {
  ran_at: string;
  ok: boolean;
  site: string;
  created: number;
  updated: number;
  skipped: number;
  drafted: number;
  errors: number;
  error?: string;
  siteId: string;
  /** Server clock when the report arrived — the reliable "last synced" time. */
  receivedAt: string;
}

/** Whether the WordPress copy is behind FreshPress (Phase 3, Chunk 8). */
export interface ConnectorDrift {
  behind: boolean;
  lastPublishedAt: string | null;
  lastPulledAt: string | null;
}

/** Masked WordPress Connector token status — never carries the token itself. `lastUsedAt` is the plugin's last manifest/page pull. */
export interface ConnectorTokenStatus {
  connected: boolean;
  createdAt?: string;
  lastUsedAt?: string;
  /** Latest sync the WordPress plugin reported back (null until the first sync). */
  lastReport?: ConnectorSyncReport | null;
  /** Drift indicator: is WordPress behind the latest publish? */
  drift?: ConnectorDrift;
}

export const api = {
  listSites: () => request<SiteMeta[]>('/sites'),
  listTeamMembers: () => request<TeamMember[]>('/team/members'),
  createTeamMember: (input: {
    email: string;
    displayName: string;
    password: string;
    role?: 'owner' | 'admin' | 'member';
    canPublish?: boolean;
  }) => request<TeamMember>('/team/members', { method: 'POST', body: JSON.stringify(input) }),
  updateTeamMember: (
    id: string,
    patch: { role?: 'owner' | 'admin' | 'member'; canPublish?: boolean; displayName?: string }
  ) => request<TeamMember>(`/team/members/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTeamMember: (id: string) =>
    request<void>(`/team/members/${id}`, { method: 'DELETE' }),
  getSite: (siteId: string) => request<Site>(`/sites/${siteId}`),
  createSite: (name: string, domain?: string) =>
    request<Site>('/sites', { method: 'POST', body: JSON.stringify({ name, domain }) }),
  setPassword: (siteId: string, password: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  updateSite: (siteId: string, patch: Partial<Pick<SiteMeta, 'name' | 'domain' | 'clientCanPublish'>>) =>
    request<SiteMeta>(`/sites/${siteId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // ── WordPress Connector token (owner/admin only) ─────────────────────────────
  getConnectorToken: (siteId: string) =>
    request<ConnectorTokenStatus>(`/sites/${siteId}/connect/token`),
  /** Issue or rotate the site's connector token — the plaintext is returned exactly once. */
  issueConnectorToken: (siteId: string) =>
    request<{ token: string }>(`/sites/${siteId}/connect/token`, { method: 'POST' }),
  revokeConnectorToken: (siteId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/connect/token`, { method: 'DELETE' }),
  ingestPage: (siteId: string, url: string) =>
    request<SitePage>(`/sites/${siteId}/pages/ingest`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  updatePage: (siteId: string, pageId: string, changes: SlotChange[]) =>
    request<{ page: SitePage; html: string }>(`/sites/${siteId}/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ changes }),
    }),
  listVersions: (siteId: string) => request<SiteVersion[]>(`/sites/${siteId}/versions`),
  createVersion: (siteId: string, label?: string) =>
    request<SiteVersion>(`/sites/${siteId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  restoreVersion: (siteId: string, versionId: string) =>
    request<Site>(`/sites/${siteId}/versions/${versionId}/restore`, { method: 'POST' }),
  publish: (siteId: string, label?: string, deploy = true) =>
    request<{ publish: { id: string; deploymentUrl?: string }; deploymentUrl?: string }>(
      `/sites/${siteId}/publish`,
      { method: 'POST', body: JSON.stringify({ label, deploy }) }
    ),
  listPublishes: (siteId: string) => request<PublishRecord[]>(`/sites/${siteId}/publishes`),
  rollbackPublish: (siteId: string, publishId: string) =>
    request<{ ok: boolean; versionId: string; publish: PublishRecord }>(
      `/sites/${siteId}/publishes/${publishId}/rollback`,
      { method: 'POST' }
    ),
  submitReview: (siteId: string, note?: string) =>
    request<{ review: SiteReviewState }>(`/sites/${siteId}/submit-review`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  approveReview: (siteId: string, label?: string, deploy = true) =>
    request<{ publish: { id: string; deploymentUrl?: string }; deploymentUrl?: string }>(
      `/sites/${siteId}/review/approve`,
      { method: 'POST', body: JSON.stringify({ label, deploy }) }
    ),
  rejectReview: (siteId: string, note?: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/review/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  chat: (siteId: string, pageId: string, message: string, elementId?: string) =>
    request<{ explanation: string; html: string; page: SitePage; warnings?: string[] }>(
      `/sites/${siteId}/pages/${pageId}/chat`,
      { method: 'POST', body: JSON.stringify({ message, elementId }) }
    ),
  downloadWordPressTheme: async (siteId: string, siteName: string) => {
    const token = getToken();
    const res = await fetch(`/api/sites/${siteId}/wordpress/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? 'Download failed');
    }
    const blob = await res.blob();
    const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freshpress-${slug}-wordpress-theme.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },
  previewWordPressImport: async (wxrFile: File): Promise<ImportPreview> => {
    const token = getToken();
    const form = new FormData();
    form.append('wxr', wxrFile);
    const res = await fetch('/api/import/wordpress/preview', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? 'Preview failed');
    }
    return res.json();
  },
  importWordPress: async (
    wxrFile: File,
    opts: {
      sourceBaseUrl?: string;
      uploadsZip?: File;
      sitePageSlugs?: string[];
      importDrafts?: boolean;
    }
  ): Promise<{ siteId: string; jobId: string; job: ImportJob }> => {
    const token = getToken();
    const form = new FormData();
    form.append('wxr', wxrFile);
    if (opts.sourceBaseUrl) form.append('sourceBaseUrl', opts.sourceBaseUrl);
    if (opts.uploadsZip) form.append('uploadsZip', opts.uploadsZip);
    if (opts.sitePageSlugs) form.append('sitePageSlugs', JSON.stringify(opts.sitePageSlugs));
    if (opts.importDrafts) form.append('importDrafts', 'true');
    const res = await fetch('/api/import/wordpress', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? 'Import failed');
    }
    return res.json();
  },
  listArticles: (siteId: string) =>
    request<Array<{ id: string; title: string; slug: string; type: string }>>(
      `/sites/${siteId}/blog/articles`
    ),
  getEmailSettings: (siteId: string) =>
    request<{
      settings: SiteEmailSettings;
      editorUrl: string;
      contactFormSnippet: string;
      signupFormSnippet: string;
    }>(`/sites/${siteId}/email`),
  updateEmailSettings: (siteId: string, body: SiteEmailSettingsUpdate) =>
    request<{ settings: SiteEmailSettings }>(`/sites/${siteId}/email`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listSubmissions: (siteId: string) =>
    request<Array<{ id: string; name: string; email: string; message: string; pagePath?: string; createdAt: string }>>(
      `/sites/${siteId}/submissions`
    ),
  listSubscribers: (siteId: string) =>
    request<
      Array<{
        id: string;
        email: string;
        name?: string;
        status: 'pending' | 'confirmed' | 'unsubscribed';
        pagePath?: string;
        createdAt: string;
        confirmedAt?: string;
        unsubscribedAt?: string;
      }>
    >(`/sites/${siteId}/subscribers`),
  listSignupWebhooks: (siteId: string) =>
    request<Array<{ id: string; url: string; enabled: boolean; createdAt: string }>>(
      `/sites/${siteId}/signup-webhooks`
    ),
  createSignupWebhook: (siteId: string, url: string) =>
    request<{ webhook: { id: string; url: string; enabled: boolean; createdAt: string }; secret: string }>(
      `/sites/${siteId}/signup-webhooks`,
      { method: 'POST', body: JSON.stringify({ url }) }
    ),
  updateSignupWebhook: (siteId: string, webhookId: string, patch: { url?: string; enabled?: boolean }) =>
    request<{ id: string; url: string; enabled: boolean; createdAt: string }>(
      `/sites/${siteId}/signup-webhooks/${webhookId}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    ),
  deleteSignupWebhook: (siteId: string, webhookId: string) =>
    request<void>(`/sites/${siteId}/signup-webhooks/${webhookId}`, { method: 'DELETE' }),
  sendTestEmail: (siteId: string, to: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/email/test`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  sendClientInvite: (siteId: string, to: string, agencyName?: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/email/invite`, {
      method: 'POST',
      body: JSON.stringify({ to, agencyName }),
    }),
  listMedia: (siteId: string) => request<MediaAsset[]>(`/sites/${siteId}/media`),
  getIntegrations: () =>
    request<{
      openrouter: boolean;
      anthropic: boolean;
      firecrawl: boolean;
      onpage_ai: boolean;
      vercel: boolean;
      originality_ai: boolean;
      agent_media: boolean;
      defaultAiProvider: 'openrouter' | 'anthropic' | null;
      defaultAiModel: string | null;
      vercelTeamId: string | null;
      updatedAt: string | null;
    }>('/admin/integrations'),
  updateIntegrations: (body: {
    openrouter_api_key?: string | null;
    anthropic_api_key?: string | null;
    firecrawl_api_key?: string | null;
    onpage_ai_api_key?: string | null;
    vercel_token?: string | null;
    originality_ai_api_key?: string | null;
    agent_media_api_key?: string | null;
    defaultAiProvider?: 'openrouter' | 'anthropic' | null;
    defaultAiModel?: string | null;
    vercelTeamId?: string | null;
  }) =>
    request<Awaited<ReturnType<typeof api.getIntegrations>>>('/admin/integrations', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listOpenRouterModels: () =>
    request<{ models: Array<{ id: string; name: string }> }>('/admin/openrouter/models'),
  getVercelProvisioning: () =>
    request<{ mode: 'platform' | 'byo'; hasToken: boolean; teamId: string | null }>(
      '/admin/vercel/provisioning'
    ),
  provisionVercelTeam: (name: string, slug?: string) =>
    request<{ teamId: string; slug: string; name?: string }>('/admin/vercel/provision-team', {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    }),
  listDesignThemes: () =>
    request<{ themes: Array<{ id: string; name: string; desc: string; aesthetic: string }> }>(
      '/design/themes'
    ),
  previewDesignTheme: (siteId: string, themeId: string) =>
    request<{ styleGuide: StyleGuidePreview; stylesheet?: string }>(
      `/sites/${siteId}/design/preview/${themeId}`
    ),
  applyDesignTheme: (siteId: string, themeId: string) =>
    request<{ styleGuide: StyleGuidePreview; stylesheet?: string }>(
      `/sites/${siteId}/design/apply`,
      {
      method: 'POST',
      body: JSON.stringify({ themeId }),
    }),
  previewDesignThemeUrl: (siteId: string, url: string) =>
    request<{ styleGuide: StyleGuidePreview; stylesheet?: string }>(
      `/sites/${siteId}/design/preview-url`,
      {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  applyDesignThemeUrl: (siteId: string, url: string) =>
    request<{ styleGuide: StyleGuidePreview; stylesheet?: string }>(
      `/sites/${siteId}/design/apply`,
      {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  /** Import a raw DESIGN.md (e.g. authored by the Brand Studio skill) as the site's StyleGuide. */
  importSiteDesign: (siteId: string, rawDesignMd: string, name: string, aesthetic?: string) =>
    request<{ styleGuide: SiteStyleGuide; stylesheet: string }>(`/sites/${siteId}/design/import`, {
      method: 'POST',
      body: JSON.stringify({ rawDesignMd, name, aesthetic }),
    }),
  getSiteStyleGuide: (siteId: string) =>
    request<{ styleGuide: SiteStyleGuide; stylesheet: string }>(`/sites/${siteId}/design`),
  /** The editable StyleGuide surface (whitelisted fields + current values), optionally scoped to an elementType. */
  getDesignEditable: (siteId: string, elementType?: string) =>
    request<{ elementType: string | null; fields: EditableField[] }>(
      `/sites/${siteId}/design/editable${elementType ? `?elementType=${encodeURIComponent(elementType)}` : ''}`
    ),
  /** Structured Site Theme edit — a deep-partial StyleGuide patch, validated through validateStyleGuideChange. */
  patchSiteDesign: (siteId: string, patch: Record<string, unknown>, elementType?: string) =>
    request<{ styleGuide: SiteStyleGuide; stylesheet: string }>(`/sites/${siteId}/design`, {
      method: 'PATCH',
      body: JSON.stringify({ patch, elementType }),
    }),
  /** Extract a reviewable brand draft (colors/fonts/logo) from a URL — never applied without an explicit accept. */
  extractBrand: (siteId: string, url: string) =>
    request<{ extracted: ExtractedBrand; patch: Record<string, unknown> }>(
      `/sites/${siteId}/design/extract-brand`,
      { method: 'POST', body: JSON.stringify({ url }) }
    ),
  /** Site-scoped theme chat (elementType), applied through the same validated path as the panel. */
  siteDesignChat: (siteId: string, message: string, elementType?: string) =>
    request<{
      ok: boolean;
      explanation: string;
      provider: string;
      patch: Record<string, unknown>;
      styleGuide: SiteStyleGuide;
      stylesheet: string;
    }>(`/sites/${siteId}/design/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, elementType }),
    }),

  // ── Email Formats ──────────────────────────────────────────────────────────
  listEmailFormats: (siteId: string) => request<{ formats: EmailFormat[] }>(`/sites/${siteId}/email-formats`),
  createEmailFormat: (siteId: string, body: Partial<EmailFormat> = {}) =>
    request<{ format: EmailFormat }>(`/sites/${siteId}/email-formats`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateEmailFormat: (siteId: string, id: string, patch: Partial<EmailFormat>) =>
    request<{ format: EmailFormat }>(`/sites/${siteId}/email-formats/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteEmailFormat: (siteId: string, id: string) =>
    request<void>(`/sites/${siteId}/email-formats/${id}`, { method: 'DELETE' }),
  setDefaultEmailFormat: (siteId: string, id: string) =>
    request<{ formats: EmailFormat[] }>(`/sites/${siteId}/email-formats/${id}/set-default`, { method: 'POST' }),
  syncEmailFormatFromStyleGuide: (siteId: string, overwriteId?: string) =>
    request<{ format: EmailFormat }>(`/sites/${siteId}/email-formats/sync-from-style-guide`, {
      method: 'POST',
      body: JSON.stringify(overwriteId ? { overwriteId } : {}),
    }),
  exportEmailFormat: (siteId: string, id: string) =>
    request<{ payload: unknown; kind: string; schemaVersion: number }>(
      `/sites/${siteId}/email-formats/${id}/export`,
      { method: 'POST' }
    ),
  importEmailFormatFromSite: (siteId: string, sourceSiteId: string, sourceId: string) =>
    request<{ format: EmailFormat }>(`/sites/${siteId}/email-formats/import-from-site`, {
      method: 'POST',
      body: JSON.stringify({ sourceSiteId, sourceId }),
    }),

  // ── Email Templates ─────────────────────────────────────────────────────────
  listEmailTemplates: (siteId: string) =>
    request<{ templates: EmailTemplate[] }>(`/sites/${siteId}/email-templates`),
  createEmailTemplate: (siteId: string, body: Partial<EmailTemplate> = {}) =>
    request<{ template: EmailTemplate }>(`/sites/${siteId}/email-templates`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateEmailTemplate: (siteId: string, id: string, patch: Partial<EmailTemplate>) =>
    request<{ template: EmailTemplate }>(`/sites/${siteId}/email-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteEmailTemplate: (siteId: string, id: string) =>
    request<void>(`/sites/${siteId}/email-templates/${id}`, { method: 'DELETE' }),
  setDefaultEmailTemplate: (siteId: string, id: string) =>
    request<{ templates: EmailTemplate[] }>(`/sites/${siteId}/email-templates/${id}/set-default`, {
      method: 'POST',
    }),
  importEmailTemplateFromSite: (siteId: string, sourceSiteId: string, sourceId: string) =>
    request<{ template: EmailTemplate }>(`/sites/${siteId}/email-templates/import-from-site`, {
      method: 'POST',
      body: JSON.stringify({ sourceSiteId, sourceId }),
    }),

  // ── Brand defaults ───────────────────────────────────────────────────────────
  getEmailBrandDefaults: (siteId: string) =>
    request<{ brandDefaults: SiteEmailBrandDefaults }>(`/sites/${siteId}/email-brand-defaults`),
  updateEmailBrandDefaults: (siteId: string, body: SiteEmailBrandDefaults) =>
    request<{ brandDefaults: SiteEmailBrandDefaults }>(`/sites/${siteId}/email-brand-defaults`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // ── Compose ──────────────────────────────────────────────────────────────────
  previewComposeEmail: (
    siteId: string,
    body: {
      formatId: string;
      templateId: string;
      subject: string;
      previewText?: string;
      bodyHtml: string;
      includeBrand: boolean;
      includeSignature: boolean;
    }
  ) => request<{ html: string }>(`/sites/${siteId}/email-compose/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  sendComposeEmail: (
    siteId: string,
    body: {
      to: string;
      formatId: string;
      templateId: string;
      subject: string;
      previewText?: string;
      bodyHtml: string;
      includeBrand: boolean;
      includeSignature: boolean;
    }
  ) => request<{ ok: boolean; id?: string }>(`/sites/${siteId}/email-compose/send`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  // ── Inbound Email (domain setup) ────────────────────────────────────────────
  getInboundDomainConfig: (siteId: string) =>
    request<{ config: InboundEmailConfig | null; records: InboundDomainRecord[] }>(
      `/sites/${siteId}/inbound-email/domain`
    ),
  setupInboundDomain: (siteId: string, body: { domainChoice: 'root' | 'subdomain'; domain: string }) =>
    request<{ config: InboundEmailConfig; records: InboundDomainRecord[] }>(
      `/sites/${siteId}/inbound-email/domain`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  verifyInboundDomain: (siteId: string) =>
    request<{ config: InboundEmailConfig; records: InboundDomainRecord[] }>(
      `/sites/${siteId}/inbound-email/domain/verify`,
      { method: 'POST' }
    ),

  // ── Inbox (folders) ──────────────────────────────────────────────────────────
  listInboxFolders: (siteId: string) =>
    request<{ folders: EmailFolder[] }>(`/sites/${siteId}/inbox/folders`),
  createInboxFolder: (siteId: string, body: { name: string; color?: string; parentFolderId?: string }) =>
    request<{ folder: EmailFolder }>(`/sites/${siteId}/inbox/folders`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateInboxFolder: (
    siteId: string,
    folderId: string,
    body: Partial<{
      name: string;
      color: string;
      parentFolderId: string | null;
      filterRule: EmailFolderFilterRule | null;
    }>
  ) =>
    request<{ folder: EmailFolder }>(`/sites/${siteId}/inbox/folders/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteInboxFolder: (siteId: string, folderId: string) =>
    request<void>(`/sites/${siteId}/inbox/folders/${folderId}`, { method: 'DELETE' }),
  applyInboxFolderFilter: (siteId: string, folderId: string) =>
    request<{ movedCount: number }>(`/sites/${siteId}/inbox/folders/${folderId}/apply-filter`, {
      method: 'POST',
    }),

  // ── Inbox (threads) ──────────────────────────────────────────────────────────
  listInboxThreads: (siteId: string, folderId?: string) =>
    request<{ threads: EmailThread[] }>(
      `/sites/${siteId}/inbox/threads${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`
    ),
  getInboxThread: (siteId: string, threadId: string) =>
    request<{ thread: EmailThread; messages: EmailInboxMessage[] }>(`/sites/${siteId}/inbox/threads/${threadId}`),
  updateInboxThread: (siteId: string, threadId: string, body: Partial<{ isRead: boolean; folderId: string }>) =>
    request<{ thread: EmailThread }>(`/sites/${siteId}/inbox/threads/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  replyToThread: (siteId: string, threadId: string, body: EmailComposeSendBody) =>
    request<{ message: EmailInboxMessage; thread: EmailThread }>(`/sites/${siteId}/inbox/threads/${threadId}/reply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  composeInboxMessage: (siteId: string, body: EmailComposeSendBody & { to: string[]; subject: string }) =>
    request<{ message: EmailInboxMessage; thread: EmailThread }>(`/sites/${siteId}/inbox/compose`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateInboxMessage: (siteId: string, messageId: string, body: Partial<EmailComposeSendBody & { subject: string }>) =>
    request<{ message: EmailInboxMessage; thread?: EmailThread }>(`/sites/${siteId}/inbox/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteInboxMessage: (siteId: string, messageId: string) =>
    request<void>(`/sites/${siteId}/inbox/messages/${messageId}`, { method: 'DELETE' }),
  autoDraftReply: (siteId: string, threadId: string) =>
    request<{ message: EmailInboxMessage; generated: boolean }>(`/sites/${siteId}/inbox/threads/${threadId}/auto-draft`, {
      method: 'POST',
    }),
  getInboxDashboard: (siteId: string) => request<EmailInboxDashboard>(`/sites/${siteId}/inbox/dashboard`),

  listBlogSilos: (siteId: string) => request<BlogSilo[]>(`/sites/${siteId}/blog/silos`),
  createBlogPillar: (siteId: string, body: { keyword: string; slug: string; title: string }) =>
    request<{ pillar: BlogPillar; pillarPost: BlogPost }>(`/sites/${siteId}/blog/pillars`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createSupportivePost: (siteId: string, pillarId: string, body: { title: string; slug: string }) =>
    request<BlogPost>(`/sites/${siteId}/blog/pillars/${pillarId}/posts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getBlogPost: (siteId: string, postId: string) =>
    request<BlogPost>(`/sites/${siteId}/blog/posts/${postId}`),
  updateBlogPost: (siteId: string, postId: string, body: Partial<BlogPost>) =>
    request<BlogPost>(`/sites/${siteId}/blog/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listBlogSeoRecipes: (siteId: string, postId: string) =>
    request<{
      recipes: Array<{ id: string; number: number; title: string; description?: string }>;
      pageUrl: string;
      keyword: string;
    }>(`/sites/${siteId}/blog/posts/${postId}/seo-recipes`),
  detectBlogAi: (siteId: string, postId: string, html?: string) =>
    request<{ score: number; provider: string; note?: string }>(
      `/sites/${siteId}/blog/posts/${postId}/detect-ai`,
      { method: 'POST', body: JSON.stringify(html ? { html } : {}) }
    ),
  detectAiContent: (siteId: string, html: string) =>
    request<{ score: number; provider: string; note?: string }>(
      `/sites/${siteId}/humanizer/detect-ai`,
      { method: 'POST', body: JSON.stringify({ html }) }
    ),
  humanizeBlogPost: (siteId: string, postId: string, opts?: HumanizeRequestOptions) =>
    request<HumanizeResult>(`/sites/${siteId}/blog/posts/${postId}/humanize`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
  humanizeContent: (siteId: string, opts: HumanizeRequestOptions & { html: string }) =>
    request<HumanizeResult>(`/sites/${siteId}/humanizer/humanize`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  humanizePageSlot: (
    siteId: string,
    pageId: string,
    slotId: string,
    opts?: HumanizeRequestOptions
  ) =>
    request<HumanizeResult>(`/sites/${siteId}/pages/${pageId}/slots/${slotId}/humanize`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
  humanizeCampaignStep: (
    siteId: string,
    campaignId: string,
    stepId: string,
    opts?: HumanizeRequestOptions
  ) =>
    request<HumanizeResult>(
      `/sites/${siteId}/campaigns/${campaignId}/steps/${stepId}/humanize`,
      { method: 'POST', body: JSON.stringify(opts ?? {}) }
    ),
  updateCampaignStep: (
    siteId: string,
    campaignId: string,
    stepId: string,
    body: Partial<CampaignStep>
  ) =>
    request<CampaignStep>(`/sites/${siteId}/campaigns/${campaignId}/steps/${stepId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getHumanizerConfig: (siteId: string) =>
    request<{
      config: HumanizerSiteConfig;
      upstream: { version: string; syncedAt: string } | null;
    }>(`/sites/${siteId}/humanizer-config`),
  getBrandResearch: (siteId: string) =>
    request<{ research: BrandResearch }>(`/sites/${siteId}/brand-research`),
  updateBrandResearch: (siteId: string, body: BrandResearchPatchBody) =>
    request<{ research: BrandResearch }>(`/sites/${siteId}/brand-research`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  generateBrandResearchStep: (siteId: string, step: BrandResearchStep) =>
    request<{
      step: BrandResearchStep;
      doc: NonNullable<BrandResearchDocsMap[BrandResearchStep]>;
      staleInputs: BrandResearchStep[];
    }>(`/sites/${siteId}/brand-research/generate/${step}`, { method: 'POST' }),
  updateHumanizerConfig: (siteId: string, body: Partial<HumanizerSiteConfig>) =>
    request<HumanizerSiteConfig>(`/sites/${siteId}/humanizer-config`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getHumanizerPromptPreview: (siteId: string) =>
    request<{ length: number; estimatedTokens: number }>(
      `/sites/${siteId}/humanizer/prompt-preview`
    ),
  syncHumanizerUpstream: () =>
    request<{ version: string; syncedAt: string }>('/admin/humanizer/sync-upstream', {
      method: 'POST',
    }),
  listRssFeeds: (siteId: string) =>
    request<Array<{ id: string; url: string; label: string }>>(`/sites/${siteId}/blog/rss-feeds`),
  addRssFeed: (siteId: string, url: string, label: string) =>
    request<{ id: string; url: string; label: string }>(`/sites/${siteId}/blog/rss-feeds`, {
      method: 'POST',
      body: JSON.stringify({ url, label }),
    }),
  listCampaigns: (siteId: string) =>
    request<
      Array<{
        id: string;
        name: string;
        status: string;
        pillarId?: string;
        keyword?: string;
        engine?: 'native';
        audience?: CampaignAudience;
      }>
    >(`/sites/${siteId}/campaigns`),
  /** One per pillar: 409 if the pillar already has a campaign. */
  createCampaign: (siteId: string, pillarId: string) =>
    request<{
      campaign: { id: string; name: string; audience?: CampaignAudience };
      steps: CampaignStep[];
    }>(`/sites/${siteId}/campaigns`, { method: 'POST', body: JSON.stringify({ pillarId }) }),
  /** The site's one catch-all campaign, for signups no blog campaign covers. 409 if it already has one. */
  createWelcomeCampaign: (siteId: string) =>
    request<{
      campaign: { id: string; name: string; audience?: CampaignAudience };
      steps: CampaignStep[];
    }>(`/sites/${siteId}/campaigns`, { method: 'POST', body: JSON.stringify({ audience: 'welcome' }) }),
  getCampaign: (siteId: string, campaignId: string) =>
    request<{
      campaign: { id: string; name: string; status?: string; engine?: 'native'; audience?: CampaignAudience };
      steps: CampaignStep[];
      enrollments?: { active: number; completed: number; stopped: number };
    }>(`/sites/${siteId}/campaigns/${campaignId}`),
  activateCampaign: (siteId: string, campaignId: string, opts?: { enrollExisting?: boolean }) =>
    request<{ campaign: { id: string }; enrolledExisting: number }>(
      `/sites/${siteId}/campaigns/${campaignId}/activate`,
      { method: 'POST', body: JSON.stringify(opts ?? {}) }
    ),
  pauseCampaign: (siteId: string, campaignId: string) =>
    request<{ campaign: { id: string } }>(`/sites/${siteId}/campaigns/${campaignId}/pause`, { method: 'POST' }),
  getBlogSeoRecipe: (siteId: string, postId: string, recipeId: string) =>
    request<{ id: string; title: string; content: string; pageUrl: string; keyword: string }>(
      `/sites/${siteId}/blog/posts/${postId}/seo-recipes/${recipeId}`
    ),

  getSocialConfig: (siteId: string) => request<SocialSiteConfig>(`/sites/${siteId}/social-config`),
  updateSocialConfig: (siteId: string, body: Partial<SocialSiteConfig>) =>
    request<SocialSiteConfig>(`/sites/${siteId}/social-config`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  generateSocialDrafts: (siteId: string, postId: string, opts?: { includeFullScreenCards?: boolean }) =>
    request<{ batch: SocialGenerationBatch; overlapWarning?: { run: number } }>(
      `/sites/${siteId}/blog/posts/${postId}/social/generate`,
      { method: 'POST', body: JSON.stringify(opts ?? {}) }
    ),
  listSocialBatches: (siteId: string, filters?: { sourcePostId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (filters?.sourcePostId) q.set('sourcePostId', filters.sourcePostId);
    if (filters?.status) q.set('status', filters.status);
    const qs = q.toString();
    return request<SocialGenerationBatch[]>(`/sites/${siteId}/social/batches${qs ? `?${qs}` : ''}`);
  },
  getSocialBatch: (siteId: string, batchId: string) =>
    request<SocialGenerationBatch>(`/sites/${siteId}/social/batches/${batchId}`),
  acceptSocialBatch: (
    siteId: string,
    batchId: string,
    selections: Array<{
      variantId: string;
      includeHero?: boolean;
      includeTextCardLight?: boolean;
      includeTextCardDark?: boolean;
    }>
  ) =>
    request<{ drafts: SocialPostDraft[] }>(`/sites/${siteId}/social/batches/${batchId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ selections }),
    }),
  listSocialDrafts: (siteId: string, filters?: { sourcePostId?: string; platform?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (filters?.sourcePostId) q.set('sourcePostId', filters.sourcePostId);
    if (filters?.platform) q.set('platform', filters.platform);
    if (filters?.status) q.set('status', filters.status);
    const qs = q.toString();
    return request<SocialPostDraft[]>(`/sites/${siteId}/social/drafts${qs ? `?${qs}` : ''}`);
  },
  getSocialDraft: (siteId: string, draftId: string) =>
    request<{ draft: SocialPostDraft; blogUrl?: string }>(`/sites/${siteId}/social/drafts/${draftId}`),
  updateSocialDraft: (siteId: string, draftId: string, body: Partial<SocialPostDraft>) =>
    request<SocialPostDraft>(`/sites/${siteId}/social/drafts/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  markSocialDraftPublished: (siteId: string, draftId: string) =>
    request<SocialPostDraft>(`/sites/${siteId}/social/drafts/${draftId}/publish`, { method: 'POST' }),
  regenerateSocialCards: (siteId: string, draftId: string) =>
    request<SocialPostDraft>(`/sites/${siteId}/social/drafts/${draftId}/regenerate-cards`, { method: 'POST' }),
  humanizeSocialDraft: (siteId: string, draftId: string, opts?: HumanizeRequestOptions) =>
    request<HumanizeResult>(`/sites/${siteId}/social/drafts/${draftId}/humanize`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
  uploadMedia: async (siteId: string, file: File) => {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sites/${siteId}/media/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? 'Upload failed');
    }
    return res.json() as Promise<{ id: string; publicPath: string; filename: string }>;
  },

  // ── Design System Generation ──────────────────────────────────────────────
  generateDesignSystem: (
    siteId: string,
    intake: {
      brandName: string;
      industry?: string;
      personality: string[];
      targetAudience?: string;
      colorPreferences?: string;
      referenceUrls?: string[];
      existingBrandNotes?: string;
      moodKeywords?: string[];
    },
    extracted?: ExtractedBrand
  ) =>
    request<{ styleGuide: StyleGuidePreview; stylesheet?: string; rawDesignMd: string }>(
      `/sites/${siteId}/design/generate`,
      { method: 'POST', body: JSON.stringify(extracted ? { ...intake, extracted } : intake) }
    ),

  // ── Site Generation (Chunk 8/9 — page directions + apply) ────────────────
  generateSiteDirections: (siteId: string, intake: SiteDirectionsIntake) =>
    request<{ directions: GeneratedDirection[]; styleGuideId: string; critiqueSkipped?: 'not_entitled' }>(
      `/sites/${siteId}/generate`,
      { method: 'POST', body: JSON.stringify(intake) }
    ),

  applyGeneratedPages: (siteId: string, pages: Array<{ path: string; title: string; content: PageContent }>) =>
    request<{ pages: SitePage[] }>(`/sites/${siteId}/pages/apply-generated`, {
      method: 'POST',
      body: JSON.stringify({ pages }),
    }),

  // ── Agent Media: Image Generation ────────────────────────────────────────
  getMediaGenerateStatus: (siteId: string) =>
    request<{ configured: boolean }>(`/sites/${siteId}/media/generate-status`),

  startGenerateImage: (siteId: string, body: { prompt: string; style?: string }) =>
    request<{ jobId: string; groundedPrompt: string }>(
      `/sites/${siteId}/media/generate-image`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  pollGenerateImage: (siteId: string, jobId: string) =>
    request<{ status: string; imageUrl: string | null }>(
      `/sites/${siteId}/media/generate-image/${jobId}`
    ),

  // ── Agent Media: Video Generation ────────────────────────────────────────
  startGenerateVideo: (
    siteId: string,
    body: { description: string; script: string; duration?: number; subtitles?: boolean }
  ) =>
    request<{ jobId: string; groundedDescription: string }>(
      `/sites/${siteId}/media/generate-video`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  pollGenerateVideo: (siteId: string, jobId: string) =>
    request<{ status: string; videoUrl: string | null }>(
      `/sites/${siteId}/media/generate-video/${jobId}`
    ),
};
