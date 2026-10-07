import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getStorage } from '../storage/filesystem.js';
import { requireOwner } from '../auth/middleware.js';
import { requireFeature } from '../auth/entitlements.js';
import { SignupWebhookSchema } from '../email/validate.js';
import { encryptWebhookSecret } from '../storage/signup-webhook-secrets.js';
import type { SignupWebhook, Subscriber } from '../storage/types.js';
import { routeParam } from '../util/params.js';

const router = Router();

// Signups ride the email system (confirmation emails need a provider), so they share its tier gate.
const requireEmailSystem = requireFeature('emailSystem');

const MAX_WEBHOOKS_PER_SITE = 10;

/** Owner-facing subscriber shape — tokens never leave the server. */
function publicSubscriber(s: Subscriber) {
  return {
    id: s.id,
    email: s.email,
    name: s.name,
    status: s.status,
    pagePath: s.pagePath,
    createdAt: s.createdAt,
    confirmedAt: s.confirmedAt,
    unsubscribedAt: s.unsubscribedAt,
  };
}

/** Owner-facing webhook shape — the signing secret is shown once at creation, never read back. */
function publicWebhook(hook: SignupWebhook) {
  return { id: hook.id, url: hook.url, enabled: hook.enabled, createdAt: hook.createdAt };
}

router.get('/sites/:siteId/subscribers', requireOwner, requireEmailSystem, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  const subscribers = await storage.listSubscribers(site.meta.id);
  res.json(subscribers.map(publicSubscriber));
});

router.get('/sites/:siteId/signup-webhooks', requireOwner, requireEmailSystem, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  res.json((site.meta.signupWebhooks ?? []).map(publicWebhook));
});

/** Create a webhook. The response carries the signing secret exactly once. */
router.post('/sites/:siteId/signup-webhooks', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const parsed = SignupWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid webhook "url" is required' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const existing = site.meta.signupWebhooks ?? [];
    if (existing.length >= MAX_WEBHOOKS_PER_SITE) {
      res.status(400).json({ error: `A site can have at most ${MAX_WEBHOOKS_PER_SITE} signup webhooks` });
      return;
    }

    const secret = `whsec_${nanoid(32)}`;
    const hook: SignupWebhook = {
      id: nanoid(10),
      url: parsed.data.url,
      secret: encryptWebhookSecret(secret),
      enabled: parsed.data.enabled ?? true,
      createdAt: new Date().toISOString(),
    };
    await storage.updateSiteMeta(site.meta.id, { signupWebhooks: [...existing, hook] });

    res.status(201).json({ webhook: publicWebhook(hook), secret });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create webhook' });
  }
});

router.patch('/sites/:siteId/signup-webhooks/:webhookId', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const parsed = SignupWebhookSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid webhook patch' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const hooks = site.meta.signupWebhooks ?? [];
    const webhookId = routeParam(req.params.webhookId);
    const hook = hooks.find((h) => h.id === webhookId);
    if (!hook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    const updated: SignupWebhook = {
      ...hook,
      ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    };
    await storage.updateSiteMeta(site.meta.id, {
      signupWebhooks: hooks.map((h) => (h.id === webhookId ? updated : h)),
    });
    res.json(publicWebhook(updated));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update webhook' });
  }
});

router.delete('/sites/:siteId/signup-webhooks/:webhookId', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const hooks = site.meta.signupWebhooks ?? [];
    const webhookId = routeParam(req.params.webhookId);
    if (!hooks.some((h) => h.id === webhookId)) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    await storage.updateSiteMeta(site.meta.id, { signupWebhooks: hooks.filter((h) => h.id !== webhookId) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete webhook' });
  }
});

export default router;
