import { describe, it, expect, afterEach } from 'vitest';
import { inboundWebhookUrl, publicInboundConfig } from './email-inbound.js';

describe('inboundWebhookUrl', () => {
  const prevAppUrl = process.env.APP_URL;

  afterEach(() => {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
  });

  it('builds the webhook URL from APP_URL', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(inboundWebhookUrl('site1')).toBe('https://app.example.com/api/webhooks/resend/inbound/site1');
  });

  it('strips a trailing slash from APP_URL', () => {
    process.env.APP_URL = 'https://app.example.com/';
    expect(inboundWebhookUrl('site1')).toBe('https://app.example.com/api/webhooks/resend/inbound/site1');
  });

  it('falls back to localhost when APP_URL is unset', () => {
    delete process.env.APP_URL;
    expect(inboundWebhookUrl('site1')).toBe('http://localhost:3001/api/webhooks/resend/inbound/site1');
  });
});

describe('publicInboundConfig', () => {
  it('returns null for an unset config', () => {
    expect(publicInboundConfig(undefined)).toBeNull();
  });

  it('strips webhookSecret and adds a hasWebhookSecret flag', () => {
    const result = publicInboundConfig({
      enabled: true,
      domainChoice: 'subdomain',
      domain: 'mail.example.com',
      resendDomainId: 'dom_1',
      verified: true,
      webhookSecret: 'whsec_super_secret',
    });
    expect(result).not.toHaveProperty('webhookSecret');
    expect(result).toEqual({
      enabled: true,
      domainChoice: 'subdomain',
      domain: 'mail.example.com',
      resendDomainId: 'dom_1',
      verified: true,
      hasWebhookSecret: true,
    });
  });

  it('reports hasWebhookSecret: false when no secret is set', () => {
    const result = publicInboundConfig({ enabled: false, domainChoice: 'root', verified: false });
    expect(result?.hasWebhookSecret).toBe(false);
  });
});
