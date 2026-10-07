import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from './vault.js';

describe('vault', () => {
  const prevMaster = process.env.MASTER_KEY;

  beforeEach(() => {
    process.env.MASTER_KEY = 'test-master-key-for-vault';
    delete process.env.KEY_ENCRYPTION_SECRET;
  });

  afterEach(() => {
    if (prevMaster === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = prevMaster;
  });

  it('encrypts and decrypts round-trip', () => {
    const plain = 'sk-or-test-key-12345';
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });
});
