export type EmailFolderKind = 'system' | 'custom';
export type EmailSystemFolderType = 'inbox' | 'drafts' | 'sent';

export type EmailFolderFilterMatchType = 'keyword' | 'senderDomain';

export interface EmailFolderFilterRule {
  matchType: EmailFolderFilterMatchType;
  /** Subject substring (keyword) or sender domain (senderDomain), case-insensitive. */
  value: string;
}

export interface EmailFolder {
  id: string;
  siteId: string;
  name: string;
  kind: EmailFolderKind;
  systemType?: EmailSystemFolderType;
  order: number;
  /** User-assigned color (e.g. per-campaign/per-client categorization) — swatch value, not a CSS token. */
  color?: string;
  parentFolderId?: string;
  /** When set, new inbound mail matching this rule routes here instead of Inbox — shown via a funnel icon. */
  filterRule?: EmailFolderFilterRule;
  createdAt: string;
  updatedAt: string;
}

export type EmailThreadCategory = 'personal' | 'promo' | 'newsletter';

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
  /** Set at ingestion by a lightweight classifier — only non-promo threads get AI auto-drafts. */
  category?: EmailThreadCategory;
  createdAt: string;
  updatedAt: string;
}

export type EmailMessageDirection = 'inbound' | 'outbound';
export type EmailMessageStatus = 'draft' | 'scheduled' | 'sent' | 'received';

export interface EmailMessage {
  id: string;
  siteId: string;
  threadId: string;
  direction: EmailMessageDirection;
  status: EmailMessageStatus;
  from: string;
  to: string[];
  subject: string;
  bodyHtml: string;
  /** Message-Id header this message was sent/received with, used for In-Reply-To/References threading. */
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  /** Set when status is 'scheduled' — when the background scheduler should actually send this message. */
  scheduledAt?: string;
  /** True for a draft the auto-draft feature generated (vs. one the user started manually) — shown as a badge. */
  isAiGenerated?: boolean;
  /**
   * Rendering ingredients captured at schedule-time so the background scheduler can reproduce the exact
   * send the user configured — mirrors BrandComposeControls/MessageComposer's client-side state, since the
   * scheduler fires with no live client request to resupply them.
   */
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
