import { render } from '@react-email/render';
import type { Site } from '../storage/types.js';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { sendBrandedEmail, buildEditorUrl } from './send.js';
import { ReviewSubmittedEmail, ReviewResolvedEmail } from './templates.js';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';

/**
 * Review notifications are best-effort: they ride the site's own Resend config and must
 * never fail the underlying request. If email isn't configured for the site, we skip.
 */

/** Notify every workspace user who can publish that a review is awaiting them. */
export async function notifyReviewSubmitted(
  site: Site,
  opts: { submittedBy: string; note?: string }
): Promise<void> {
  if (!site.meta.email?.enabled) return;
  try {
    const store = await getWorkspaceUsersStore();
    const users = await store.listUsers();
    const reviewers = users.filter((u) => u.role === 'owner' || u.permissions.canPublish);
    if (reviewers.length === 0) return;

    const editorUrl = buildEditorUrl(site.meta.id, APP_URL);
    const html = await render(
      ReviewSubmittedEmail({
        siteName: site.meta.name,
        editorUrl,
        submittedBy: opts.submittedBy,
        note: opts.note,
      })
    );

    for (const reviewer of reviewers) {
      try {
        await sendBrandedEmail(site.meta.email, {
          to: reviewer.email,
          subject: `Review requested: ${site.meta.name}`,
          html,
        });
      } catch (err) {
        console.warn(`[review-notify] failed to email reviewer ${reviewer.email}:`, err);
      }
    }
  } catch (err) {
    console.warn('[review-notify] submit notification failed:', err);
  }
}

/** Notify the original submitter (when we have an email) that their review was resolved. */
export async function notifyReviewResolved(
  site: Site,
  opts: { to?: string | null; outcome: 'published' | 'rejected'; note?: string }
): Promise<void> {
  if (!site.meta.email?.enabled || !opts.to) return;
  try {
    const editorUrl = buildEditorUrl(site.meta.id, APP_URL);
    const html = await render(
      ReviewResolvedEmail({
        siteName: site.meta.name,
        editorUrl,
        outcome: opts.outcome,
        note: opts.note,
      })
    );
    await sendBrandedEmail(site.meta.email, {
      to: opts.to,
      subject:
        opts.outcome === 'published'
          ? `Published: ${site.meta.name}`
          : `Changes need another look: ${site.meta.name}`,
      html,
    });
  } catch (err) {
    console.warn('[review-notify] resolve notification failed:', err);
  }
}
