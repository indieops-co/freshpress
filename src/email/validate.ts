import { z } from 'zod';
import type { SiteEmailConfig } from '../storage/types.js';
import { EmailFormatSchema } from '../design/email-format.js';
import { EmailTemplateSchema } from '../design/email-template.js';

export const ContactFormSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  message: z.string().min(1).max(5000),
  pagePath: z.string().max(500).optional(),
});

export const SignupFormSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().max(200).optional(),
  pagePath: z.string().max(500).optional(),
});

export const SignupWebhookSchema = z.object({
  url: z.string().url().max(2000),
  enabled: z.boolean().optional(),
});

const SCRIPT_OR_HTML_PATTERN = /<script\b|javascript:|on\w+\s*=|<\/?[a-z][\s\S]*>/i;

export const EmailSettingsSchema = z.object({
  provider: z.enum(['resend', 'sendgrid', 'postmark', 'smtp']).optional(),
  resendApiKey: z.string().min(10).optional(),
  /** SendGrid / Postmark key — shorter floor than Resend's, Postmark tokens are UUIDs */
  apiKey: z.string().min(8).optional(),
  smtp: z
    .object({
      host: z.string().min(1).max(255).optional(),
      port: z.coerce.number().int().min(1).max(65535).optional(),
      secure: z.boolean().optional(),
      username: z.string().max(320).optional(),
      password: z.string().min(1).max(1024).optional(),
    })
    .optional(),
  fromEmail: z.string().email().optional(),
  fromName: z.string().max(100).optional(),
  notifyEmail: z.string().email().optional(),
  successMessage: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

export const InviteEmailSchema = z.object({
  to: z.string().email(),
  agencyName: z.string().max(100).optional(),
});

export const TestEmailSchema = z.object({
  to: z.string().email(),
});

// EmailFormat/EmailTemplate: allow create/update with a partial body — id/siteId/createdAt/updatedAt
// are always assigned server-side, never trusted from the client.
export const EmailFormatUpdateSchema = EmailFormatSchema.omit({
  id: true,
  siteId: true,
  createdAt: true,
  updatedAt: true,
  provenance: true,
}).partial({ isDefault: true, visibility: true });

export const EmailTemplateUpdateSchema = EmailTemplateSchema.omit({
  id: true,
  siteId: true,
  createdAt: true,
  updatedAt: true,
}).partial({ isDefault: true, visibility: true, maxWidth: true });

export const EmailBrandDefaultsSchema = z.object({
  activeFormatId: z.string().optional(),
  activeTemplateId: z.string().optional(),
  includeBrandDefault: z.boolean(),
  includeSignatureDefault: z.boolean(),
  signature: z
    .object({
      name: z.string().max(200).optional(),
      title: z.string().max(200).optional(),
      company: z.string().max(200).optional(),
      phone: z.string().max(50).optional(),
      extraHtml: z.string().max(500).optional(),
    })
    .optional(),
});

export const ComposeSendSchema = z.object({
  to: z.string().email(),
  formatId: z.string(),
  templateId: z.string(),
  subject: z.string().min(1).max(300),
  previewText: z.string().max(300).optional(),
  bodyHtml: z.string().max(50000),
  includeBrand: z.boolean(),
  includeSignature: z.boolean(),
});

export const ComposePreviewSchema = ComposeSendSchema.omit({ to: true });

export const ImportFromSiteSchema = z.object({
  sourceSiteId: z.string(),
  sourceId: z.string(),
});

/** Deterministic validation for merged site email / form config */
export function validateEmailConfig(config: SiteEmailConfig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.notifyEmail?.trim()) {
    const parsed = z.string().email().safeParse(config.notifyEmail.trim());
    if (!parsed.success) errors.push('Notification email must be valid');
  }

  if (config.successMessage?.trim()) {
    if (SCRIPT_OR_HTML_PATTERN.test(config.successMessage)) {
      errors.push('Success message must not contain scripts or HTML');
    }
  }

  if (config.enabled && !config.notifyEmail?.trim()) {
    errors.push('Notification email is required when the contact form is enabled');
  }

  return { ok: errors.length === 0, errors };
}
