import { render } from '@react-email/render';
import type { SiteEmailConfig, FormSubmission } from '../storage/types.js';
import { decryptSiteEmailConfig } from '../storage/site-email-secrets.js';
import { hasProviderCredentials, resolveProvider } from './providers/index.js';
import type { OutboundEmail, SendResult } from './providers/index.js';
import {
  ClientInviteEmail,
  ContactNotificationEmail,
  SignupConfirmEmail,
  TestEmail,
} from './templates.js';

export type { SendResult } from './providers/index.js';

function fromParts(config: SiteEmailConfig): OutboundEmail['from'] {
  const email = config.fromEmail?.trim();
  if (!email) throw new Error('From email is required');
  return { email, name: config.fromName?.trim() || 'FreshPress' };
}

function requireConfig(config?: SiteEmailConfig): SiteEmailConfig {
  if (!config?.enabled || !hasProviderCredentials(config)) {
    throw new Error('Email is not configured for this site — connect an email provider in Site Settings → Email');
  }
  if (!config.fromEmail?.trim()) {
    throw new Error('From email is required (a sender address verified with your email provider)');
  }
  // Credentials are stored encrypted at rest — decrypt (tolerantly) before use.
  return decryptSiteEmailConfig(config);
}

export async function sendTestEmail(
  config: SiteEmailConfig,
  siteName: string,
  to: string
): Promise<SendResult> {
  const cfg = requireConfig(config);
  const html = await render(TestEmail({ siteName }));
  return resolveProvider(cfg).send({
    from: fromParts(cfg),
    to,
    subject: `FreshPress email test — ${siteName}`,
    html,
  });
}

export async function sendClientInvite(
  config: SiteEmailConfig,
  opts: { siteName: string; editorUrl: string; to: string; agencyName?: string }
): Promise<SendResult> {
  const cfg = requireConfig(config);
  const html = await render(
    ClientInviteEmail({
      siteName: opts.siteName,
      editorUrl: opts.editorUrl,
      agencyName: opts.agencyName,
    })
  );
  return resolveProvider(cfg).send({
    from: fromParts(cfg),
    to: opts.to,
    subject: `Edit your site: ${opts.siteName}`,
    html,
  });
}

export async function sendContactNotification(
  config: SiteEmailConfig,
  siteName: string,
  submission: FormSubmission
): Promise<SendResult | null> {
  const cfg = requireConfig(config);
  const to = cfg.notifyEmail?.trim() || cfg.fromEmail?.trim();
  if (!to) throw new Error('Notify email or from email is required');

  const html = await render(
    ContactNotificationEmail({
      siteName,
      name: submission.name,
      email: submission.email,
      message: submission.message,
      pagePath: submission.pagePath,
    })
  );
  return resolveProvider(cfg).send({
    from: fromParts(cfg),
    to,
    replyTo: submission.email,
    subject: `Contact form: ${submission.name} — ${siteName}`,
    html,
  });
}

/** Double-opt-in confirmation for a new signup — the only email a pending subscriber ever gets. */
export async function sendSignupConfirmation(
  config: SiteEmailConfig,
  siteName: string,
  opts: { to: string; confirmUrl: string }
): Promise<SendResult> {
  const cfg = requireConfig(config);
  const html = await render(SignupConfirmEmail({ siteName, confirmUrl: opts.confirmUrl }));
  return resolveProvider(cfg).send({
    from: fromParts(cfg),
    to: opts.to,
    subject: `Confirm your subscription — ${siteName}`,
    html,
  });
}

export async function sendBrandedEmail(
  config: SiteEmailConfig,
  opts: { to: string; subject: string; html?: string; text?: string; headers?: Record<string, string> }
): Promise<SendResult> {
  const cfg = requireConfig(config);
  return resolveProvider(cfg).send({
    from: fromParts(cfg),
    to: opts.to,
    subject: opts.subject,
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.text ? { text: opts.text } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
}

export function maskApiKey(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '••••••••';
  return `••••••••${key.slice(-4)}`;
}

export function buildContactFormSnippet(siteId: string, appUrl: string): string {
  const action = `${appUrl.replace(/\/$/, '')}/api/public/sites/${siteId}/contact`;
  return `<!-- FreshPress contact form — posts to your FreshPress server -->
<form action="${action}" method="POST">
  <input type="hidden" name="_format" value="json" />
  <label>Name <input type="text" name="name" required /></label>
  <label>Email <input type="email" name="email" required /></label>
  <label>Message <textarea name="message" required></textarea></label>
  <button type="submit">Send</button>
</form>`;
}

export function buildSignupFormSnippet(siteId: string, appUrl: string): string {
  const action = `${appUrl.replace(/\/$/, '')}/api/public/sites/${siteId}/subscribe`;
  return `<!-- FreshPress signup form — posts to your FreshPress server -->
<form action="${action}" method="POST" data-fp-form="signup">
  <input type="hidden" name="_format" value="json" />
  <label>Name <input type="text" name="name" /></label>
  <label>Email <input type="email" name="email" required /></label>
  <button type="submit">Subscribe</button>
</form>`;
}

export function buildEditorUrl(siteId: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/editor/?site=${siteId}`;
}
