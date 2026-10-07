import { getStorage } from '../storage/filesystem.js';
import { getCampaignStore, type CampaignStore } from '../storage/campaigns.js';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { hasFeature } from '../auth/entitlements.js';
import { sendBrandedEmail } from '../email/send.js';
import { buildUnsubscribeUrl } from '../email/signups.js';
import {
  advanceEnrollment,
  appendCampaignFooter,
  campaignComplianceHeaders,
  isCampaignLive,
  stopEnrollment,
} from '../email/campaign-engine.js';
import { renderStepEmailHtml } from '../api/campaigns.js';
import type { StorageAdapter } from '../storage/types.js';
import type { PlanTier } from '../auth/types.js';

export interface CampaignSendDeps {
  campaigns: Pick<
    CampaignStore,
    'listDueEnrollments' | 'getEnrollmentById' | 'getCampaign' | 'listSteps' | 'saveEnrollment'
  >;
  storage: Pick<StorageAdapter, 'getSite' | 'findSubscriberByEmail'>;
  /** Defaults to the real `sendBrandedEmail` (hits the site's provider) — override in tests. */
  send: typeof sendBrandedEmail;
  /** Defaults to the real brand-pipeline renderer — override in tests. */
  renderStep: typeof renderStepEmailHtml;
  getPlanTier: () => Promise<PlanTier>;
  now: () => string;
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';

/**
 * Drains due campaign enrollments — the native replacement for Resend
 * Automations, running on the same tick as sendScheduledEmails. Every send
 * goes through the provider adapter with one-click-unsubscribe compliance
 * headers and a visible unsubscribe footer, and the subscriber's status is
 * re-checked at send time (an unsubscribe between steps stops the sequence).
 * Per-enrollment failures are logged and retried next tick; never throws.
 *
 * Claim before send: each enrollment is re-read fresh (the due list is a
 * snapshot) and the advanced enrollment is saved BEFORE the provider call, so a
 * successful send can't repeat because of anything that happens after it. A
 * failed (or throwing) send restores the pre-send enrollment so it retries.
 * Overlapping runs are prevented by the caller wrapping this in
 * `skipWhileRunning` (single instance, so no distributed lock).
 */
export async function sendDueCampaignSteps(deps?: Partial<CampaignSendDeps>): Promise<void> {
  const campaigns = deps?.campaigns ?? (await getCampaignStore());
  const storage = deps?.storage ?? (await getStorage());
  const send = deps?.send ?? sendBrandedEmail;
  const renderStep = deps?.renderStep ?? renderStepEmailHtml;
  const now = deps?.now ?? (() => new Date().toISOString());
  const getPlanTier =
    deps?.getPlanTier ??
    (async () => (await (await getWorkspaceUsersStore()).getWorkspace())?.planTier ?? 'free');

  // Same tier gate as scheduled sends: enrollments queued before a downgrade
  // stay 'active' and resume if the workspace upgrades again.
  if (!hasFeature(await getPlanTier(), 'emailSystem')) return;

  const due = await campaigns.listDueEnrollments(now());

  for (const snapshot of due) {
    try {
      // Re-read: skip if a previous run already sent this step, or it was stopped/rescheduled since.
      const enrollment = await campaigns.getEnrollmentById(snapshot.siteId, snapshot.id);
      if (
        !enrollment ||
        enrollment.status !== 'active' ||
        !enrollment.nextSendAt ||
        enrollment.nextSendAt > now() ||
        enrollment.nextStepOrder !== snapshot.nextStepOrder
      ) {
        continue;
      }

      const campaign = await campaigns.getCampaign(enrollment.siteId, enrollment.campaignId);
      // Paused/deleted/legacy (never natively activated) campaigns skip without stopping —
      // they resume where they left off on (re)activation.
      if (!campaign || !isCampaignLive(campaign)) continue;

      const site = await storage.getSite(enrollment.siteId);
      if (!site?.meta.email?.enabled) {
        console.error(`Campaign send skipped: site ${enrollment.siteId} has no email configured (enrollment ${enrollment.id})`);
        continue;
      }

      // Suppression check at send time — enrollment state can lag an unsubscribe.
      const subscriber = await storage.findSubscriberByEmail(enrollment.siteId, enrollment.email);
      if (!subscriber || subscriber.status !== 'confirmed') {
        await campaigns.saveEnrollment(stopEnrollment(enrollment, 'unsubscribed', now()));
        continue;
      }

      const steps = await campaigns.listSteps(enrollment.siteId, enrollment.campaignId);
      const step = steps[enrollment.nextStepOrder];
      if (!step) {
        // Steps were edited shorter than this enrollment's position — nothing left to send.
        const { nextSendAt: _nextSendAt, ...rest } = enrollment;
        await campaigns.saveEnrollment({ ...rest, status: 'completed', completedAt: now() });
        continue;
      }

      const unsubscribeUrl = buildUnsubscribeUrl(enrollment.siteId, APP_URL, subscriber.unsubscribeToken);
      const html = await renderStep(enrollment.siteId, step, site.meta.name);

      // Claim before send: if this save fails we never call the provider.
      await campaigns.saveEnrollment(advanceEnrollment(enrollment, steps, now()));

      let sendError: string | undefined;
      try {
        sendError = (
          await send(site.meta.email, {
            to: subscriber.email,
            subject: step.subject,
            html: appendCampaignFooter(html, site.meta.name, unsubscribeUrl),
            headers: campaignComplianceHeaders(unsubscribeUrl),
          })
        ).error;
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err);
      }

      if (sendError) {
        console.error(`Campaign send failed for enrollment ${enrollment.id} (step ${step.order}): ${sendError}`);
        // Release the claim so it retries next tick. If this restore itself fails, the step is
        // skipped rather than risking a double send.
        await campaigns.saveEnrollment(enrollment);
      }
    } catch (err) {
      console.error(`Campaign send failed for enrollment ${snapshot.id}:`, err);
    }
  }
}
