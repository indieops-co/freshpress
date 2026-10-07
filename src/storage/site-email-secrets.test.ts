import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptSiteEmailConfig,
  decryptSiteEmailConfig,
  encryptInboundConfig,
  decryptInboundConfig,
} from './site-email-secrets.js';

describe('site-email-secrets', () => {
  const prevMaster = process.env.MASTER_KEY;

  beforeEach(() => {
    process.env.MASTER_KEY = 'test-master-key-for-site-email';
    delete process.env.KEY_ENCRYPTION_SECRET;
  });

  afterEach(() => {
    if (prevMaster === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = prevMaster;
  });

  it('round-trips an encrypted resendApiKey', () => {
    const config = { resendApiKey: 're_test_1234567890', fromEmail: 'a@b.com', enabled: true };
    const encrypted = encryptSiteEmailConfig(config);
    expect(encrypted.resendApiKey).not.toBe(config.resendApiKey);
    const decrypted = decryptSiteEmailConfig(encrypted);
    expect(decrypted.resendApiKey).toBe(config.resendApiKey);
  });

  it('is a no-op when resendApiKey is absent', () => {
    const config = { fromEmail: 'a@b.com', enabled: true };
    expect(encryptSiteEmailConfig(config)).toEqual(config);
    expect(decryptSiteEmailConfig(config)).toEqual(config);
  });

  it('tolerates a legacy plaintext key (pre-encryption installs) without throwing', () => {
    const legacyPlaintext = { resendApiKey: 're_legacy_plaintext_key', fromEmail: 'a@b.com' };
    const decrypted = decryptSiteEmailConfig(legacyPlaintext);
    expect(decrypted.resendApiKey).toBe('re_legacy_plaintext_key');
  });

  it('round-trips a provider apiKey (SendGrid/Postmark)', () => {
    const config = { provider: 'sendgrid' as const, apiKey: 'SG.test_1234567890', fromEmail: 'a@b.com' };
    const encrypted = encryptSiteEmailConfig(config);
    expect(encrypted.apiKey).not.toBe(config.apiKey);
    expect(decryptSiteEmailConfig(encrypted).apiKey).toBe(config.apiKey);
  });

  it('round-trips smtp.password and leaves other smtp fields untouched', () => {
    const config = {
      provider: 'smtp' as const,
      smtp: { host: 'smtp.example.com', port: 587, username: 'u@example.com', password: 'hunter22' },
    };
    const encrypted = encryptSiteEmailConfig(config);
    expect(encrypted.smtp?.password).not.toBe('hunter22');
    expect(encrypted.smtp?.host).toBe('smtp.example.com');
    const decrypted = decryptSiteEmailConfig(encrypted);
    expect(decrypted.smtp?.password).toBe('hunter22');
    expect(decrypted.smtp?.username).toBe('u@example.com');
  });

  it('encrypts every present credential field independently', () => {
    const config = { resendApiKey: 're_test_1234567890', apiKey: 'pm-token-abc123', smtp: { password: 'pw' } };
    const encrypted = encryptSiteEmailConfig(config);
    expect(encrypted.resendApiKey).not.toBe(config.resendApiKey);
    expect(encrypted.apiKey).not.toBe(config.apiKey);
    expect(encrypted.smtp?.password).not.toBe('pw');
    const decrypted = decryptSiteEmailConfig(encrypted);
    expect(decrypted).toEqual({ ...config, smtp: { password: 'pw' } });
  });
});

describe('inbound-email webhookSecret encryption', () => {
  const prevMaster = process.env.MASTER_KEY;

  beforeEach(() => {
    process.env.MASTER_KEY = 'test-master-key-for-site-email';
    delete process.env.KEY_ENCRYPTION_SECRET;
  });

  afterEach(() => {
    if (prevMaster === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = prevMaster;
  });

  it('round-trips an encrypted webhookSecret', () => {
    const config = { enabled: true, domainChoice: 'subdomain' as const, verified: false, webhookSecret: 'whsec_1234567890' };
    const encrypted = encryptInboundConfig(config);
    expect(encrypted.webhookSecret).not.toBe(config.webhookSecret);
    const decrypted = decryptInboundConfig(encrypted);
    expect(decrypted.webhookSecret).toBe(config.webhookSecret);
  });

  it('is a no-op when webhookSecret is absent', () => {
    const config = { enabled: false, domainChoice: 'root' as const, verified: false };
    expect(encryptInboundConfig(config)).toEqual(config);
    expect(decryptInboundConfig(config)).toEqual(config);
  });
});
