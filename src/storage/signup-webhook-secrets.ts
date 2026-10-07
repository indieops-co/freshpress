import { encryptSecret, decryptSecret } from '../crypto/vault.js';

/**
 * SignupWebhook.secret at-rest encryption — same vault (AES-256-GCM) and same
 * tolerant-decrypt pattern as site-email-secrets.ts. The secret is generated
 * server-side, shown to the owner exactly once at webhook creation, and only
 * ever read back to sign outgoing payloads.
 */

export function encryptWebhookSecret(secret: string): string {
  return encryptSecret(secret.trim());
}

export function decryptWebhookSecret(stored: string): string {
  try {
    return decryptSecret(stored);
  } catch {
    return stored;
  }
}
