import { Router } from 'express';
import { getStorage } from '../storage/filesystem.js';
import { requireOwner, requireSiteAccess } from '../auth/middleware.js';
import { requireFeature } from '../auth/entitlements.js';
import {
  sendTestEmail,
  sendClientInvite,
  maskApiKey,
  buildContactFormSnippet,
  buildSignupFormSnippet,
  buildEditorUrl,
} from '../email/send.js';
import { EmailSettingsSchema, InviteEmailSchema, TestEmailSchema, validateEmailConfig } from '../email/validate.js';
import type { SiteEmailConfig } from '../storage/types.js';
import { encryptSiteEmailConfig, decryptSiteEmailConfig } from '../storage/site-email-secrets.js';
import { activeProviderId, hasProviderCredentials } from '../email/providers/index.js';
import { routeParam } from '../util/params.js';

const router = Router();

// Email system is a paid feature: every admin-side email route carries the tier
// gate. (The Resend inbound webhook and public form-submission routes are separate
// and deliberately ungated.)
const requireEmailSystem = requireFeature('emailSystem');
const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

function publicEmailSettings(email?: SiteEmailConfig) {
  if (!email) return { enabled: false, provider: 'resend' as const };
  const decrypted = decryptSiteEmailConfig(email);
  const provider = activeProviderId(email);
  const activeKey = provider === 'resend' ? decrypted.resendApiKey : decrypted.apiKey;
  return {
    enabled: !!email.enabled,
    provider,
    fromEmail: email.fromEmail,
    fromName: email.fromName,
    notifyEmail: email.notifyEmail,
    successMessage: email.successMessage,
    // "hasApiKey" predates multi-provider; the UI reads it as "credentials configured".
    hasApiKey: hasProviderCredentials(email),
    apiKeyPreview: maskApiKey(activeKey),
    ...(email.smtp
      ? {
          smtp: {
            host: email.smtp.host,
            port: email.smtp.port,
            secure: email.smtp.secure,
            username: email.smtp.username,
            hasPassword: Boolean(email.smtp.password),
          },
        }
      : {}),
  };
}

/** Get email settings (masked — owner only) */
router.get('/sites/:siteId/email', requireOwner, requireEmailSystem, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  res.json({
    settings: publicEmailSettings(site.meta.email),
    editorUrl: buildEditorUrl(site.meta.id, APP_URL),
    contactFormSnippet: buildContactFormSnippet(site.meta.id, APP_URL),
    signupFormSnippet: buildSignupFormSnippet(site.meta.id, APP_URL),
  });
});

/** Save email provider settings (owner only — BYOK) */
router.put('/sites/:siteId/email', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const parsed = EmailSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const current = site.meta.email ?? {};
    const next: SiteEmailConfig = {
      ...current,
      ...(parsed.data.provider !== undefined ? { provider: parsed.data.provider } : {}),
      ...(parsed.data.fromEmail !== undefined ? { fromEmail: parsed.data.fromEmail } : {}),
      ...(parsed.data.fromName !== undefined ? { fromName: parsed.data.fromName } : {}),
      ...(parsed.data.notifyEmail !== undefined ? { notifyEmail: parsed.data.notifyEmail } : {}),
      ...(parsed.data.successMessage !== undefined
        ? { successMessage: parsed.data.successMessage }
        : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    };

    const configCheck = validateEmailConfig({ ...next, resendApiKey: parsed.data.resendApiKey ?? next.resendApiKey });
    if (!configCheck.ok) {
      res.status(400).json({ error: configCheck.errors.join(', ') });
      return;
    }

    // Only freshly-submitted secrets get encrypted here — values carried over from
    // `current` unchanged are already ciphertext, and must not be encrypted twice.
    if (parsed.data.resendApiKey?.trim()) {
      next.resendApiKey = encryptSiteEmailConfig({ resendApiKey: parsed.data.resendApiKey.trim() }).resendApiKey;
    }
    if (parsed.data.apiKey?.trim()) {
      next.apiKey = encryptSiteEmailConfig({ apiKey: parsed.data.apiKey.trim() }).apiKey;
    }
    if (parsed.data.smtp) {
      const { password, ...smtpRest } = parsed.data.smtp;
      next.smtp = { ...current.smtp, ...smtpRest };
      if (password?.trim()) {
        next.smtp.password = encryptSiteEmailConfig({ smtp: { password: password.trim() } }).smtp!.password;
      }
    }

    const meta = await storage.updateSiteMeta(routeParam(req.params.siteId), { email: next });
    res.json({ settings: publicEmailSettings(meta.email) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save email settings' });
  }
});

/** Send test email */
router.post('/sites/:siteId/email/test', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const parsed = TestEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid "to" email is required' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site?.meta.email) {
      res.status(400).json({ error: 'Configure email settings first' });
      return;
    }

    const result = await sendTestEmail(site.meta.email, site.meta.name, parsed.data.to);
    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Test send failed' });
  }
});

/** Email client their editor link */
router.post('/sites/:siteId/email/invite', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const parsed = InviteEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid client "to" email is required' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site?.meta.email) {
      res.status(400).json({ error: 'Configure email settings first' });
      return;
    }

    const result = await sendClientInvite(site.meta.email, {
      siteName: site.meta.name,
      editorUrl: buildEditorUrl(site.meta.id, APP_URL),
      to: parsed.data.to,
      agencyName: parsed.data.agencyName,
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Invite send failed' });
  }
});

/** List stored form submissions */
router.get('/sites/:siteId/submissions', siteAuth, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  const submissions = await storage.listSubmissions(routeParam(req.params.siteId));
  res.json(submissions);
});

export default router;
