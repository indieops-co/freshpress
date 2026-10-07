import { Router } from 'express';
import { Resend } from 'resend';
import { requireOwner } from '../auth/middleware.js';
import { requireFeature } from '../auth/entitlements.js';
import { routeParam } from '../util/params.js';
import { getStorage } from '../storage/filesystem.js';
import { decryptSiteEmailConfig, encryptInboundConfig } from '../storage/site-email-secrets.js';
import { providerSupportsInbound } from '../email/providers/index.js';
import type { SiteEmailConfig, SiteInboundEmailConfig } from '../storage/types.js';

const router = Router();

// Email system is a paid feature: every admin-side email route carries the tier
// gate. (The Resend inbound webhook and public form-submission routes are separate
// and deliberately ungated.)
const requireEmailSystem = requireFeature('emailSystem');

/** The built-in inbox rides Resend's Domains + inbound webhooks — other providers can't offer it. */
function resendClientFor(email?: SiteEmailConfig): Resend {
  if (!providerSupportsInbound(email ?? {})) {
    throw new Error('The built-in inbox requires the Resend provider — switch in Site Settings → Email');
  }
  const resendApiKey = decryptSiteEmailConfig(email ?? {}).resendApiKey;
  if (!resendApiKey?.trim()) {
    throw new Error('Configure a Resend API key in Site Settings → Email first');
  }
  return new Resend(resendApiKey.trim());
}

export function inboundWebhookUrl(siteId: string): string {
  const base = (process.env.APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  return `${base}/api/webhooks/resend/inbound/${siteId}`;
}

/** Public shape for the client — never leaks the (encrypted-at-rest) webhookSecret. */
export function publicInboundConfig(config?: SiteInboundEmailConfig) {
  if (!config) return null;
  const { webhookSecret, ...rest } = config;
  return { ...rest, hasWebhookSecret: Boolean(webhookSecret) };
}

router.get('/sites/:siteId/inbound-email/domain', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const inbound = site.meta.inboundEmail;
    if (!inbound?.resendDomainId) {
      res.json({ config: publicInboundConfig(inbound), records: [] });
      return;
    }

    const resend = resendClientFor(site.meta.email);
    const { data, error } = await resend.domains.get(inbound.resendDomainId);
    if (error || !data) {
      res.json({ config: publicInboundConfig(inbound), records: [] });
      return;
    }

    const verified = data.status === 'verified';
    let latest = inbound;
    if (verified !== inbound.verified) {
      const meta = await storage.updateSiteMeta(siteId, { inboundEmail: { ...inbound, verified } });
      latest = meta.inboundEmail!;
    }
    res.json({ config: publicInboundConfig(latest), records: data.records });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load domain config' });
  }
});

router.post('/sites/:siteId/inbound-email/domain', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { domainChoice, domain } = req.body as { domainChoice?: 'root' | 'subdomain'; domain?: string };
    if (domainChoice !== 'root' && domainChoice !== 'subdomain') {
      res.status(400).json({ error: 'domainChoice must be "root" or "subdomain"' });
      return;
    }
    if (!domain?.trim()) {
      res.status(400).json({ error: 'domain is required' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const resend = resendClientFor(site.meta.email);

    const { data: domainData, error: domainError } = await resend.domains.create({ name: domain.trim() });
    if (domainError || !domainData) {
      res.status(502).json({ error: domainError?.message ?? 'Failed to register domain with Resend' });
      return;
    }

    // One inbound webhook per site's own Resend account (BYOK — each site's API key is its own account).
    const { data: webhookData, error: webhookError } = await resend.webhooks.create({
      endpoint: inboundWebhookUrl(siteId),
      events: ['email.received'],
    });
    if (webhookError || !webhookData) {
      res.status(502).json({ error: webhookError?.message ?? 'Failed to register inbound webhook with Resend' });
      return;
    }

    const config = encryptInboundConfig({
      enabled: true,
      domainChoice,
      domain: domain.trim(),
      resendDomainId: domainData.id,
      verified: domainData.status === 'verified',
      webhookSecret: webhookData.signing_secret,
    });
    const meta = await storage.updateSiteMeta(siteId, { inboundEmail: config });

    res.json({ config: publicInboundConfig(meta.inboundEmail), records: domainData.records });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to set up inbound domain' });
  }
});

router.post('/sites/:siteId/inbound-email/domain/verify', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    const inbound = site?.meta.inboundEmail;
    if (!site || !inbound?.resendDomainId) {
      res.status(400).json({ error: 'No inbound domain configured for this site yet' });
      return;
    }
    const resend = resendClientFor(site.meta.email);

    await resend.domains.verify(inbound.resendDomainId);
    const { data, error } = await resend.domains.get(inbound.resendDomainId);
    if (error || !data) {
      res.status(502).json({ error: error?.message ?? 'Failed to check verification status' });
      return;
    }

    const verified = data.status === 'verified';
    const meta = await storage.updateSiteMeta(siteId, { inboundEmail: { ...inbound, verified } });
    res.json({ config: publicInboundConfig(meta.inboundEmail), records: data.records });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Verification check failed' });
  }
});

export default router;
