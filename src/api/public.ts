import { Router } from 'express';
import { getStorage } from '../storage/filesystem.js';
import { ContactFormSchema, SignupFormSchema } from '../email/validate.js';
import { sendContactNotification, sendSignupConfirmation } from '../email/send.js';
import { applySignup, buildConfirmUrl, confirmSubscriber, unsubscribeSubscriber } from '../email/signups.js';
import { dispatchSubscriberEvent } from '../email/signup-webhooks.js';
import { enrollInMatchingCampaigns, stopActiveEnrollments } from '../email/campaign-enroll.js';
import { routeParam } from '../util/params.js';

const router = Router();

const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';

/** Minimal branded page for the visitor-facing confirm/unsubscribe links. */
function publicPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1117;color:#e8eaef;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#1a1d27;border-radius:12px;padding:2.5rem;max-width:26rem;text-align:center}h1{font-size:1.35rem;margin:0 0 .75rem}p{color:#8b92a5;line-height:1.6;margin:0}</style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}

/** Public contact form endpoint for published client sites */
router.post('/public/sites/:siteId/contact', async (req, res) => {
  try {
    const parsed = ContactFormSchema.safeParse({
      name: req.body.name,
      email: req.body.email,
      message: req.body.message,
      pagePath: req.body.pagePath ?? req.body.page,
    });

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid form data', details: parsed.error.flatten() });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    if (!site.meta.email?.enabled) {
      res.status(503).json({ error: 'Contact form is not enabled for this site' });
      return;
    }

    const submission = await storage.addSubmission(routeParam(req.params.siteId), parsed.data);
    const sendResult = await sendContactNotification(site.meta.email, site.meta.name, submission);

    if (sendResult?.error) {
      res.status(502).json({
        ok: true,
        stored: true,
        warning: `Submission saved but email failed: ${sendResult.error}`,
        submissionId: submission.id,
      });
      return;
    }

    res.status(201).json({ ok: true, submissionId: submission.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Submission failed' });
  }
});

/** Public email-signup endpoint for published client sites (double opt-in). */
router.post('/public/sites/:siteId/subscribe', async (req, res) => {
  try {
    const parsed = SignupFormSchema.safeParse({
      email: req.body.email,
      name: req.body.name,
      pagePath: req.body.pagePath ?? req.body.page,
    });
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid signup data', details: parsed.error.flatten() });
      return;
    }

    const siteId = routeParam(req.params.siteId);
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    if (!site.meta.email?.enabled) {
      res.status(503).json({ error: 'Signups are not enabled for this site' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = await storage.findSubscriberByEmail(siteId, email);
    const outcome = applySignup(existing, siteId, { ...parsed.data, email });

    // Idempotent + non-enumerating: a repeat signup looks identical from outside.
    if (outcome.action === 'already-confirmed') {
      res.json({ ok: true });
      return;
    }

    const saved = await storage.saveSubscriber(siteId, outcome.subscriber);
    const confirmUrl = buildConfirmUrl(siteId, APP_URL, saved.confirmToken!);
    const sendResult = await sendSignupConfirmation(site.meta.email, site.meta.name, {
      to: saved.email,
      confirmUrl,
    });

    if (sendResult.error) {
      res.status(502).json({
        ok: true,
        stored: true,
        warning: `Signup saved but confirmation email failed: ${sendResult.error}`,
      });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Signup failed' });
  }
});

/** Double-opt-in confirmation link (from the confirmation email). Renders a page, not JSON. */
router.get('/public/sites/:siteId/subscribe/confirm', async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    const subscriber = site && token ? await storage.findSubscriberByToken(siteId, 'confirmToken', token) : null;

    if (!site || !subscriber) {
      res
        .status(404)
        .type('html')
        .send(publicPage('Link expired', 'This confirmation link is no longer valid. Sign up again to get a fresh one.'));
      return;
    }

    const confirmed = confirmSubscriber(subscriber);
    await storage.saveSubscriber(siteId, confirmed);
    // Best-effort trigger fan-out — never blocks or fails the visitor's confirmation.
    void dispatchSubscriberEvent(site.meta, 'subscriber.confirmed', confirmed).catch((err) =>
      console.error('Signup webhook dispatch failed:', err)
    );
    void enrollInMatchingCampaigns(siteId, confirmed).catch((err) =>
      console.error('Campaign enrollment failed:', err)
    );

    res.type('html').send(publicPage("You're subscribed", `Thanks — your subscription to ${site.meta.name} is confirmed.`));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Confirmation failed' });
  }
});

/** Shared unsubscribe transition — used by both the human GET link and the RFC 8058 one-click POST. */
async function processUnsubscribe(siteId: string, token: string): Promise<{ siteName: string } | null> {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  const subscriber = site && token ? await storage.findSubscriberByToken(siteId, 'unsubscribeToken', token) : null;
  if (!site || !subscriber) return null;

  if (subscriber.status !== 'unsubscribed') {
    const unsubscribed = unsubscribeSubscriber(subscriber);
    await storage.saveSubscriber(siteId, unsubscribed);
    void dispatchSubscriberEvent(site.meta, 'subscriber.unsubscribed', unsubscribed).catch((err) =>
      console.error('Signup webhook dispatch failed:', err)
    );
    void stopActiveEnrollments(siteId, unsubscribed.id).catch((err) =>
      console.error('Stopping campaign enrollments failed:', err)
    );
  }
  return { siteName: site.meta.name };
}

/** One-click unsubscribe link. Renders a page, not JSON. */
router.get('/public/sites/:siteId/unsubscribe', async (req, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const result = await processUnsubscribe(routeParam(req.params.siteId), token);
    if (!result) {
      res.status(404).type('html').send(publicPage('Link not found', 'This unsubscribe link is not valid.'));
      return;
    }
    res.type('html').send(publicPage("You're unsubscribed", `You will no longer receive emails from ${result.siteName}.`));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unsubscribe failed' });
  }
});

/** RFC 8058 one-click unsubscribe: mail clients POST here from the List-Unsubscribe header. */
router.post('/public/sites/:siteId/unsubscribe', async (req, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const result = await processUnsubscribe(routeParam(req.params.siteId), token);
    if (!result) {
      res.status(404).json({ error: 'Invalid unsubscribe link' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unsubscribe failed' });
  }
});

export default router;
