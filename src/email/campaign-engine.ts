import { createHash } from 'node:crypto';
import type {
  CampaignEnrollment,
  CampaignStep,
  EmailCampaign,
  EnrollmentStopReason,
} from '../content/campaign-types.js';
import type { BlogPillar, BlogPost } from '../content/silo-types.js';
import type { Subscriber } from '../storage/types.js';

/**
 * Pure state machine for native campaign sequences — replaces the abandoned
 * Resend Automations integration. Enrollments advance through a campaign's
 * ordered steps on the scheduler tick; everything here is side-effect-free so
 * the timing/compliance logic unit-tests without stores or the network.
 */

const DAY_MS = 86_400_000;
/** Far beyond any sane nurture gap, and well inside Date's range (a huge value would make addDays throw). */
const MAX_DELAY_DAYS = 365;

/**
 * Coerces a step delay to a whole, non-negative day count. delayDays comes from AI output and
 * PATCH bodies, so it can be a string, null, negative or NaN; anything unusable → `fallback`.
 */
export function normalizeDelayDays(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), MAX_DELAY_DAYS);
}

/** Defensive on `days`: if this threw, an enrollment could never advance and its step would be stuck. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + normalizeDelayDays(days) * DAY_MS).toISOString();
}

/**
 * Deterministic per (site, campaign, subscriber), so two racing enroll calls write the same
 * record and the store's create-only-if-absent rejects the second instead of duplicating it.
 */
export function enrollmentId(siteId: string, campaignId: string, subscriberId: string): string {
  return createHash('sha256').update(`${siteId}\n${campaignId}\n${subscriberId}`).digest('hex').slice(0, 24);
}

/** Whether a campaign enrolls and sends. Legacy Resend-era 'active' campaigns (no engine marker) don't. */
export function isCampaignLive(campaign: Pick<EmailCampaign, 'status' | 'engine'>): boolean {
  return campaign.status === 'active' && campaign.engine === 'native';
}

/** The site-wide catch-all campaign. Anything else — including every record without `audience` — is per-pillar. */
export function isWelcomeCampaign(campaign: Pick<EmailCampaign, 'audience'>): boolean {
  return campaign.audience === 'welcome';
}

/**
 * The blog slug a signup page path points at: last path segment, minus query/hash, trailing
 * slash and .html/.htm, lowercased. Static blog pages are /blog/<slug>.html; WordPress ones
 * /<slug>/ or /blog/<slug>/. Returns null for the site root or a missing path.
 */
export function pagePathSlug(pagePath: string | undefined): string | null {
  if (!pagePath) return null;
  const path = pagePath.split(/[?#]/)[0].replace(/\/+$/, '');
  let slug = path.slice(path.lastIndexOf('/') + 1).replace(/\.html?$/i, '');
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Malformed %-escape — compare the raw segment.
  }
  return slug ? slug.toLowerCase() : null;
}

/**
 * Campaigns belong to one pillar: a subscriber matches only if they signed up on that pillar's
 * page or one of its posts (any status). No page path, or any other page → no match.
 */
export function signupMatchesPillar(
  pagePath: string | undefined,
  pillar: Pick<BlogPillar, 'slug'>,
  posts: Array<Pick<BlogPost, 'slug'>>
): boolean {
  const slug = pagePathSlug(pagePath);
  if (!slug) return false;
  return [pillar.slug, ...posts.map((p) => p.slug)].some((s) => !!s && s.toLowerCase() === slug);
}

/** Steps are addressed by array index (they're stored ordered 0..n). */
export function createEnrollment(
  campaign: Pick<EmailCampaign, 'id' | 'siteId'>,
  steps: CampaignStep[],
  subscriber: Pick<Subscriber, 'id' | 'email'>,
  now = new Date().toISOString()
): CampaignEnrollment {
  return {
    id: enrollmentId(campaign.siteId, campaign.id, subscriber.id),
    siteId: campaign.siteId,
    campaignId: campaign.id,
    subscriberId: subscriber.id,
    email: subscriber.email,
    status: 'active',
    nextStepOrder: 0,
    nextSendAt: addDays(now, steps[0]?.delayDays ?? 0),
    enrolledAt: now,
  };
}

/** After sending the step at nextStepOrder: move to the next step, or complete the sequence. */
export function advanceEnrollment(
  enrollment: CampaignEnrollment,
  steps: CampaignStep[],
  now = new Date().toISOString()
): CampaignEnrollment {
  const nextOrder = enrollment.nextStepOrder + 1;
  if (nextOrder >= steps.length) {
    // nextSendAt is removed (key dropped) so a completed enrollment can never look "due".
    const { nextSendAt: _nextSendAt, ...rest } = enrollment;
    return { ...rest, status: 'completed', lastSentAt: now, completedAt: now };
  }
  return {
    ...enrollment,
    nextStepOrder: nextOrder,
    nextSendAt: addDays(now, steps[nextOrder].delayDays),
    lastSentAt: now,
  };
}

export function stopEnrollment(
  enrollment: CampaignEnrollment,
  reason: EnrollmentStopReason,
  now = new Date().toISOString()
): CampaignEnrollment {
  const { nextSendAt: _nextSendAt, ...rest } = enrollment;
  return { ...rest, status: 'stopped', stoppedAt: now, stopReason: reason };
}

/**
 * Bulk-sender compliance (Gmail/Yahoo requirements): one-click unsubscribe
 * headers on every campaign send. The unsubscribe endpoint accepts both GET
 * (human click) and POST (RFC 8058 one-click from the mail client).
 */
export function campaignComplianceHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Visible unsubscribe footer — required in the body too, not just headers. */
export function appendCampaignFooter(html: string, siteName: string, unsubscribeUrl: string): string {
  return (
    `${html}\n<p style="font-size:12px;color:#8b92a5;margin-top:24px;line-height:1.5">` +
    `You're receiving this because you subscribed at ${siteName}. ` +
    `<a href="${unsubscribeUrl}" style="color:#8b92a5">Unsubscribe</a></p>`
  );
}
