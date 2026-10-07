import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function deriveKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET || process.env.MASTER_KEY;
  if (!secret) {
    throw new Error('KEY_ENCRYPTION_SECRET or MASTER_KEY required for BYOK encryption');
  }
  return createHash('sha256').update(secret).digest();
}

/** Encrypt a secret string for at-rest storage (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypt a value produced by encryptSecret. */
export function decryptSecret(ciphertext: string): string {
  const key = deriveKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
