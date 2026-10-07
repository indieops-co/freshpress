import { getCampaignStore, type CampaignStore } from '../storage/campaigns.js';
import { getBlogSiloStore, type BlogSiloStore } from '../storage/blog-silo.js';
import {
  createEnrollment,
  isCampaignLive,
  isWelcomeCampaign,
  signupMatchesPillar,
  stopEnrollment,
} from './campaign-engine.js';
import type { CampaignStep, EmailCampaign } from '../content/campaign-types.js';
import type { Subscriber } from '../storage/types.js';

/**
 * Trigger-side glue between signups (Phase 2) and campaign sequences: called
 * fire-and-forget from the public confirm/unsubscribe routes, mirroring the
 * signup-webhook dispatch — never blocks or fails the visitor flow.
 */

export interface EnrollDeps {
  campaigns: Pick<
    CampaignStore,
    'listCampaigns' | 'listSteps' | 'getEnrollment' | 'createEnrollmentIfAbsent'
  >;
  blog: Pick<BlogSiloStore, 'getPillar' | 'listPosts'>;
}

type PageMatcher = (pagePath: string | undefined) => boolean;

async function resolveDeps(deps?: Partial<EnrollDeps>): Promise<EnrollDeps> {
  return {
    campaigns: deps?.campaigns ?? (await getCampaignStore()),
    blog: deps?.blog ?? (await getBlogSiloStore()),
  };
}

/** Matcher for a campaign's pillar (its page + its posts), or null if the pillar is gone. */
async function pillarMatcher(
  blog: EnrollDeps['blog'],
  siteId: string,
  pillarId: string | undefined
): Promise<PageMatcher | null> {
  if (!pillarId) return null;
  const pillar = await blog.getPillar(siteId, pillarId);
  if (!pillar) return null;
  const posts = await blog.listPosts(siteId, pillarId);
  return (pagePath) => signupMatchesPillar(pagePath, pillar, posts);
}

/**
 * The site's live campaigns: each pillar campaign with its matcher (one whose pillar is gone
 * matches nobody, so it's left out), plus the live welcome campaign if there is one.
 */
async function liveCampaigns(
  store: EnrollDeps['campaigns'],
  blog: EnrollDeps['blog'],
  siteId: string
): Promise<{ pillar: Array<{ campaign: EmailCampaign; matches: PageMatcher }>; welcome?: EmailCampaign }> {
  const live = (await store.listCampaigns(siteId)).filter(isCampaignLive);
  const pillar: Array<{ campaign: EmailCampaign; matches: PageMatcher }> = [];
  for (const campaign of live) {
    if (isWelcomeCampaign(campaign)) continue;
    const matches = await pillarMatcher(blog, siteId, campaign.pillarId);
    if (matches) pillar.push({ campaign, matches });
  }
  // Creation allows one per site; if a race ever made two, enroll in only one of them.
  return { pillar, welcome: live.find(isWelcomeCampaign) };
}

/** Enroll one subscriber unless they ever had an enrollment (active, completed, or stopped). True if newly enrolled. */
async function enrollOnce(
  store: EnrollDeps['campaigns'],
  campaign: EmailCampaign,
  steps: CampaignStep[],
  subscriber: Subscriber
): Promise<boolean> {
  // Enrollments from before deterministic ids have random ids the create-if-absent can't collide with.
  if (await store.getEnrollment(campaign.siteId, campaign.id, subscriber.id)) return false;
  return store.createEnrollmentIfAbsent(createEnrollment(campaign, steps, subscriber));
}

/**
 * Enroll a newly-confirmed subscriber into each live campaign whose pillar they signed up on; if
 * no live pillar campaign matched (homepage, landing page, unknown page, or a pillar without a
 * live campaign), into the site's live welcome campaign instead. Idempotent.
 */
export async function enrollInMatchingCampaigns(
  siteId: string,
  subscriber: Subscriber,
  deps?: Partial<EnrollDeps>
): Promise<void> {
  const { campaigns: store, blog } = await resolveDeps(deps);
  const { pillar, welcome } = await liveCampaigns(store, blog, siteId);
  const matched = pillar.filter(({ matches }) => matches(subscriber.pagePath));
  for (const { campaign } of matched) {
    const steps = await store.listSteps(siteId, campaign.id);
    if (steps.length === 0) continue;
    await enrollOnce(store, campaign, steps, subscriber);
  }
  if (matched.length > 0 || !welcome) return;
  const welcomeSteps = await store.listSteps(siteId, welcome.id);
  if (welcomeSteps.length > 0) await enrollOnce(store, welcome, welcomeSteps, subscriber);
}

/**
 * Activation's opt-in backfill, same matching rule as new signups: a pillar campaign takes confirmed
 * subscribers who signed up on its pillar's pages; a welcome campaign takes confirmed subscribers no
 * live pillar campaign matches. Returns how many were newly enrolled.
 */
export async function enrollExistingSubscribers(
  campaign: EmailCampaign,
  steps: CampaignStep[],
  subscribers: Subscriber[],
  deps?: Partial<EnrollDeps>
): Promise<number> {
  const { campaigns: store, blog } = await resolveDeps(deps);
  let matches: PageMatcher | null;
  if (isWelcomeCampaign(campaign)) {
    const { pillar } = await liveCampaigns(store, blog, campaign.siteId);
    matches = (pagePath) => !pillar.some((p) => p.matches(pagePath));
  } else {
    matches = await pillarMatcher(blog, campaign.siteId, campaign.pillarId);
  }
  if (!matches) return 0;
  let enrolled = 0;
  for (const subscriber of subscribers) {
    if (subscriber.status !== 'confirmed' || !matches(subscriber.pagePath)) continue;
    if (await enrollOnce(store, campaign, steps, subscriber)) enrolled++;
  }
  return enrolled;
}

/** Stop every active enrollment for a subscriber — called when they unsubscribe. */
export async function stopActiveEnrollments(siteId: string, subscriberId: string): Promise<void> {
  const store = await getCampaignStore();
  const enrollments = await store.listEnrollments(siteId);
  for (const enrollment of enrollments) {
    if (enrollment.subscriberId !== subscriberId || enrollment.status !== 'active') continue;
    await store.saveEnrollment(stopEnrollment(enrollment, 'unsubscribed'));
  }
}
