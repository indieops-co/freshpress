import type { PageContent } from '../content/types.js';
import type {
  Author,
  Category,
  Tag,
  MediaAsset,
  Article,
  Comment,
  ImportJob,
} from '../content/blog-types.js';

/** Outbound email providers a site can connect (BYOK). Lives here (not src/email/) so storage stays import-root. */
export type EmailProviderId = 'resend' | 'sendgrid' | 'postmark' | 'smtp';

/** Generic SMTP transport — the "any email account" escape hatch (Google Workspace, Zoho, …). */
export interface SiteSmtpConfig {
  host?: string;
  port?: number;
  /** TLS from connection start (465). Absent = STARTTLS on 587. */
  secure?: boolean;
  username?: string;
  /** Encrypted at rest, same vault as API keys. */
  password?: string;
}

/** Per-site outbound email config — buyers connect their own provider account (BYOK) */
export interface SiteEmailConfig {
  /** Absent = 'resend': every config saved before multi-provider shipped is a Resend key. */
  provider?: EmailProviderId;
  /** Resend API key (field name predates `provider` — kept so existing configs stay valid) */
  resendApiKey?: string;
  /** SendGrid / Postmark API key */
  apiKey?: string;
  smtp?: SiteSmtpConfig;
  fromEmail?: string;
  fromName?: string;
  /** Inbox that receives contact form notifications */
  notifyEmail?: string;
  /** Plain-text message shown after successful submit (stored; public API uses generic success for now) */
  successMessage?: string;
  enabled?: boolean;
}

/** Personal sign-off block appended to outbound email when "Include Signature" is on */
export interface SiteSignatureConfig {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  /** Small optional free-form extra line, e.g. a scheduling link */
  extraHtml?: string;
}

/** Per-site defaults for the Email Format/Template compose experience */
export interface SiteEmailBrandDefaults {
  activeFormatId?: string;
  activeTemplateId?: string;
  includeBrandDefault: boolean;
  includeSignatureDefault: boolean;
  signature?: SiteSignatureConfig;
}

/** Per-site inbound-mail (webmail) receiving config — separate concern from outbound SiteEmailConfig. */
export interface SiteInboundEmailConfig {
  enabled: boolean;
  /** Root domain (e.g. clientdomain.com) or a dedicated subdomain (e.g. mail.clientdomain.com) — user's choice. */
  domainChoice: 'root' | 'subdomain';
  domain?: string;
  /** Resend's Domains API resource id, used to poll/refresh MX+DKIM verification status. */
  resendDomainId?: string;
  verified: boolean;
  /** Signing secret for verifying Resend's inbound webhook payloads (Svix/HMAC). Encrypted at rest. */
  webhookSecret?: string;
}

/** Pending content-review state for a site (absent = no review outstanding). */
export interface SiteReviewState {
  status: 'pending';
  /** Content snapshot (SiteVersion id) captured when the review was submitted */
  versionId: string;
  /** Who submitted: a workspace user id/email, or 'client' for site-password editors */
  submittedBy: string;
  submittedAt: string;
  note?: string;
}

export interface SiteMeta {
  id: string;
  name: string;
  domain?: string;
  /** Linked StyleGuide for design DNA */
  styleGuideId?: string;
  /** Original WordPress site URL when imported from WXR */
  sourceBaseUrl?: string;
  /** bcrypt hash of client password */
  clientPasswordHash?: string;
  /** When true, a site-password client may publish/deploy directly; otherwise they submit for review. Default false. */
  clientCanPublish?: boolean;
  /** Outstanding content review awaiting an approver with publish rights */
  review?: SiteReviewState;
  email?: SiteEmailConfig;
  /** Defaults for outbound email branding — separate from SiteEmailConfig (transport config) */
  emailBrandDefaults?: SiteEmailBrandDefaults;
  /** Inbound mail (webmail) receiving config — separate from SiteEmailConfig (outbound transport) */
  inboundEmail?: SiteInboundEmailConfig;
  /** Outbound webhooks fired when a subscriber confirms/unsubscribes */
  signupWebhooks?: SignupWebhook[];
  /** Per-site Named Element types discovered beyond the core taxonomy — reused on regeneration so types don't drift to synonyms */
  discoveredElementTypes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmission {
  id: string;
  siteId: string;
  name: string;
  email: string;
  message: string;
  pagePath?: string;
  createdAt: string;
}

export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';

/** One email signup captured from a published site (double opt-in). */
export interface Subscriber {
  id: string;
  siteId: string;
  /** Stored lowercased — the dedupe key within a site. */
  email: string;
  name?: string;
  status: SubscriberStatus;
  /** Single-use token in the double-opt-in confirm link; removed on confirm. */
  confirmToken?: string;
  /** Stable token for one-click unsubscribe links. */
  unsubscribeToken: string;
  /** Page the signup came from */
  pagePath?: string;
  createdAt: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
}

/** Outbound webhook fired on subscriber events — wires signups into external tools (Zapier, Instantly, …). */
export interface SignupWebhook {
  id: string;
  url: string;
  /** HMAC-SHA256 signing secret. Encrypted at rest; shown to the owner once at creation. */
  secret: string;
  enabled: boolean;
  createdAt: string;
}

/** Optional per-page SEO overrides. Absent fields fall back to the page title / excerpt. */
export interface PageSeo {
  title?: string;
  description?: string;
}

export interface SitePage {
  id: string;
  path: string;
  title: string;
  sourceUrl?: string;
  content: PageContent;
  /** Per-page SEO. Lives on the working-copy SitePage (not the PageContent snapshot). */
  seo?: PageSeo;
  updatedAt: string;
}

export interface SiteVersion {
  id: string;
  label: string;
  createdAt: string;
  /** Set when this version is the pre-publish content snapshot for a publish bundle */
  publishId?: string;
  /** pageId -> snapshot of PageContent */
  pages: Record<string, PageContent>;
}

export interface Site {
  meta: SiteMeta;
  pages: SitePage[];
}

export interface StorageAdapter {
  listSites(): Promise<SiteMeta[]>;
  getSite(siteId: string): Promise<Site | null>;
  createSite(name: string, domain?: string): Promise<Site>;
  updateSiteMeta(
    siteId: string,
    patch: Partial<
      Pick<
        SiteMeta,
        'name' | 'domain' | 'email' | 'sourceBaseUrl' | 'styleGuideId' | 'emailBrandDefaults' | 'inboundEmail' | 'signupWebhooks' | 'discoveredElementTypes' | 'clientCanPublish' | 'review'
      >
    >
  ): Promise<SiteMeta>;
  setClientPassword(siteId: string, passwordHash: string): Promise<void>;
  deleteSite(siteId: string): Promise<void>;

  listSubmissions(siteId: string): Promise<FormSubmission[]>;
  addSubmission(siteId: string, submission: Omit<FormSubmission, 'id' | 'siteId' | 'createdAt'>): Promise<FormSubmission>;
  getSubmission(siteId: string, submissionId: string): Promise<FormSubmission | null>;

  // Email signups (double opt-in)
  listSubscribers(siteId: string): Promise<Subscriber[]>;
  findSubscriberByEmail(siteId: string, email: string): Promise<Subscriber | null>;
  findSubscriberByToken(siteId: string, field: 'confirmToken' | 'unsubscribeToken', token: string): Promise<Subscriber | null>;
  /** Upsert by subscriber.id — callers build the full object (see src/email/signups.ts). */
  saveSubscriber(siteId: string, subscriber: Subscriber): Promise<Subscriber>;

  listPages(siteId: string): Promise<SitePage[]>;
  getPage(siteId: string, pageId: string): Promise<SitePage | null>;
  upsertPage(siteId: string, page: Omit<SitePage, 'updatedAt'> & { updatedAt?: string }): Promise<SitePage>;
  deletePage(siteId: string, pageId: string): Promise<void>;

  listVersions(siteId: string): Promise<SiteVersion[]>;
  getVersion(siteId: string, versionId: string): Promise<SiteVersion | null>;
  createVersion(siteId: string, label: string, options?: { publishId?: string }): Promise<SiteVersion>;
  restoreVersion(siteId: string, versionId: string): Promise<Site>;

  // Blog content (WordPress import)
  upsertAuthor(siteId: string, author: Omit<Author, 'siteId' | 'createdAt'> & { createdAt?: string }): Promise<Author>;
  listAuthors(siteId: string): Promise<Author[]>;

  upsertCategory(siteId: string, category: Omit<Category, 'siteId' | 'createdAt'> & { createdAt?: string }): Promise<Category>;
  listCategories(siteId: string): Promise<Category[]>;

  upsertTag(siteId: string, tag: Omit<Tag, 'siteId' | 'createdAt'> & { createdAt?: string }): Promise<Tag>;
  listTags(siteId: string): Promise<Tag[]>;

  upsertMediaAsset(siteId: string, asset: Omit<MediaAsset, 'siteId' | 'createdAt'> & { createdAt?: string }): Promise<MediaAsset>;
  listMediaAssets(siteId: string): Promise<MediaAsset[]>;

  upsertArticle(siteId: string, article: Omit<Article, 'siteId' | 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): Promise<Article>;
  listArticles(siteId: string): Promise<Article[]>;
  getArticle(siteId: string, articleId: string): Promise<Article | null>;

  upsertComment(siteId: string, comment: Omit<Comment, 'siteId' | 'createdAt'> & { createdAt?: string }): Promise<Comment>;
  listComments(siteId: string): Promise<Comment[]>;

  createImportJob(siteId: string): Promise<ImportJob>;
  getImportJob(siteId: string, jobId: string): Promise<ImportJob | null>;
  updateImportJob(siteId: string, job: ImportJob): Promise<ImportJob>;

  /** Absolute path to site's public media directory */
  getSitePublicDir(siteId: string): string;
}
