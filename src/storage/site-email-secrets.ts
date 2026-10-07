import { encryptSecret, decryptSecret } from '../crypto/vault.js';
import type { SiteEmailConfig, SiteInboundEmailConfig } from './types.js';

/**
 * SiteEmailConfig credential at-rest encryption, matching the pattern already
 * used by IntegrationsStore (crypto/vault.ts, AES-256-GCM). Not a flat secrets
 * map like IntegrationsStore, so encryption happens at the SiteEmailConfig
 * boundary instead of being reused verbatim from that store.
 *
 * Covered fields: resendApiKey (Resend), apiKey (SendGrid/Postmark),
 * smtp.password (generic SMTP).
 */

/**
 * Tolerant: existing installs may have plaintext secrets stored from before
 * encryption shipped. If decryption fails (wrong format / auth-tag mismatch),
 * the stored value is assumed to already be plaintext and is returned as-is —
 * the next successful PUT /email save re-encrypts it going forward.
 */
function tolerantDecrypt(value: string): string {
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

/** Encrypt any present credential fields before persisting. No-op for absent fields. */
export function encryptSiteEmailConfig(config: SiteEmailConfig): SiteEmailConfig {
  let next = config;
  if (config.resendApiKey?.trim()) {
    next = { ...next, resendApiKey: encryptSecret(config.resendApiKey.trim()) };
  }
  if (config.apiKey?.trim()) {
    next = { ...next, apiKey: encryptSecret(config.apiKey.trim()) };
  }
  if (config.smtp?.password?.trim()) {
    next = { ...next, smtp: { ...config.smtp, password: encryptSecret(config.smtp.password.trim()) } };
  }
  return next;
}

/** Decrypt credential fields for use (sending, masking, campaign automation). */
export function decryptSiteEmailConfig(config: SiteEmailConfig): SiteEmailConfig {
  let next = config;
  if (config.resendApiKey?.trim()) {
    next = { ...next, resendApiKey: tolerantDecrypt(config.resendApiKey) };
  }
  if (config.apiKey?.trim()) {
    next = { ...next, apiKey: tolerantDecrypt(config.apiKey) };
  }
  if (config.smtp?.password?.trim()) {
    next = { ...next, smtp: { ...config.smtp, password: tolerantDecrypt(config.smtp.password) } };
  }
  return next;
}

/** Same at-rest encryption pattern as SiteEmailConfig, for the inbound webhook signing secret. */
export function encryptInboundConfig(config: SiteInboundEmailConfig): SiteInboundEmailConfig {
  if (!config.webhookSecret?.trim()) return config;
  return { ...config, webhookSecret: encryptSecret(config.webhookSecret.trim()) };
}

/** Tolerant decrypt, mirroring decryptSiteEmailConfig — see tolerantDecrypt for the legacy-plaintext rationale. */
export function decryptInboundConfig(config: SiteInboundEmailConfig): SiteInboundEmailConfig {
  if (!config.webhookSecret?.trim()) return config;
  return { ...config, webhookSecret: tolerantDecrypt(config.webhookSecret) };
}
