export type CampaignStatus = 'draft' | 'active' | 'paused';

/**
 * Who a campaign enrolls. 'pillar': confirmed signups on one blog pillar's pages. 'welcome': the
 * site's single catch-all, for confirmed signups no live pillar campaign takes. Records from before
 * welcome campaigns have no `audience` and are pillar campaigns — see `isWelcomeCampaign`.
 */
export type CampaignAudience = 'pillar' | 'welcome';

export interface EmailCampaign {
  id: string;
  siteId: string;
  /** Absent = 'pillar'. */
  audience?: CampaignAudience;
  /** The blog pillar a pillar campaign belongs to. Absent on a welcome campaign. */
  pillarId?: string;
  /** The pillar's keyword. Absent on a welcome campaign. */
  keyword?: string;
  name: string;
  status: CampaignStatus;
  /**
   * Set by the native activate route. Campaigns left 'active' by the old Resend Automations
   * stub lack it, so they stay effectively paused (no enrolling, no sending) until the owner
   * activates them again — deploying the native engine must never start sending on its own.
   */
  engine?: 'native';
  /** Legacy — from the abandoned Resend Automations integration. Campaigns now send natively; never written anymore. */
  resendAutomationId?: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
}

export type EnrollmentStatus = 'active' | 'completed' | 'stopped';
export type EnrollmentStopReason = 'unsubscribed' | 'manual';

/** One subscriber's progress through one campaign's step sequence. */
export interface CampaignEnrollment {
  /** Deterministic per (site, campaign, subscriber) — see `enrollmentId`. Older records have random ids. */
  id: string;
  siteId: string;
  campaignId: string;
  subscriberId: string;
  /** Snapshot of the subscriber's email — also lets the sender re-check status at send time. */
  email: string;
  status: EnrollmentStatus;
  /** Index into the campaign's ordered steps of the next step to send. */
  nextStepOrder: number;
  /** When the next step is due. Removed (not just cleared) once completed/stopped. */
  nextSendAt?: string;
  enrolledAt: string;
  lastSentAt?: string;
  completedAt?: string;
  stoppedAt?: string;
  stopReason?: EnrollmentStopReason;
}

export interface CampaignStep {
  id: string;
  campaignId: string;
  siteId: string;
  order: number;
  subject: string;
  previewText: string;
  bodyHtml: string;
  delayDays: number;
  sourcePostId?: string;
  createdAt: string;
  updatedAt: string;
  // Forward-compat only, not yet wired into the UI or activation pipeline:
  // once set, src/api/campaigns.ts's activate route can swap `bodyHtml` for
  // `renderBrandedEmail({ format, template, bodyHtml, ... })` before sending
  // to Resend's Automations payload — see docs/plans for the Email Brand
  // Theme system.
  formatId?: string;
  templateId?: string;
  includeBrand?: boolean;
  includeSignature?: boolean;
}
