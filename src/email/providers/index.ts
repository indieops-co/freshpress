import type { EmailProviderId, SiteEmailConfig } from '../../storage/types.js';
import type { EmailProvider } from './types.js';
import { createResendProvider } from './resend.js';
import { createSendGridProvider } from './sendgrid.js';
import { createPostmarkProvider } from './postmark.js';
import { createSmtpProvider } from './smtp.js';

export type { EmailProvider, OutboundEmail, SendResult, ProviderCapabilities } from './types.js';

export const PROVIDER_LABELS: Record<EmailProviderId, string> = {
  resend: 'Resend',
  sendgrid: 'SendGrid',
  postmark: 'Postmark',
  smtp: 'SMTP (any email account)',
};

/** Configs saved before multi-provider shipped have no `provider` — they are all Resend BYOK. */
export function activeProviderId(config: SiteEmailConfig): EmailProviderId {
  return config.provider ?? 'resend';
}

/** Whether the active provider has the credentials it needs to send. */
export function hasProviderCredentials(config: SiteEmailConfig): boolean {
  switch (activeProviderId(config)) {
    case 'resend':
      return Boolean(config.resendApiKey?.trim());
    case 'sendgrid':
    case 'postmark':
      return Boolean(config.apiKey?.trim());
    case 'smtp':
      return Boolean(config.smtp?.host?.trim());
  }
}

/** The built-in inbox (Resend Domains + inbound webhooks) only exists on the Resend provider. */
export function providerSupportsInbound(config: SiteEmailConfig): boolean {
  return activeProviderId(config) === 'resend';
}

/**
 * Build the send adapter for a config whose credentials are already present
 * (checked by requireConfig) and decrypted (decryptSiteEmailConfig).
 */
export function resolveProvider(config: SiteEmailConfig): EmailProvider {
  switch (activeProviderId(config)) {
    case 'resend':
      return createResendProvider(config.resendApiKey!.trim());
    case 'sendgrid':
      return createSendGridProvider(config.apiKey!.trim());
    case 'postmark':
      return createPostmarkProvider(config.apiKey!.trim());
    case 'smtp':
      return createSmtpProvider(config.smtp!);
  }
}
