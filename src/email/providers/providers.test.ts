import { describe, it, expect, vi, afterEach } from 'vitest';
import { activeProviderId, hasProviderCredentials, providerSupportsInbound, resolveProvider } from './index.js';
import { createSendGridProvider } from './sendgrid.js';
import { createPostmarkProvider } from './postmark.js';
import type { OutboundEmail } from './types.js';

const MESSAGE: OutboundEmail = {
  from: { email: 'hello@site.com', name: 'Acme' },
  to: 'visitor@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  replyTo: 'reply@site.com',
  headers: { 'Message-Id': '<abc@site.com>' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider resolution', () => {
  it('treats a config without provider as Resend (legacy BYOK)', () => {
    const legacy = { resendApiKey: 're_key', enabled: true };
    expect(activeProviderId(legacy)).toBe('resend');
    expect(hasProviderCredentials(legacy)).toBe(true);
    expect(resolveProvider(legacy).id).toBe('resend');
  });

  it('checks the credential matching the active provider, not any credential', () => {
    expect(hasProviderCredentials({ provider: 'sendgrid', resendApiKey: 're_key' })).toBe(false);
    expect(hasProviderCredentials({ provider: 'sendgrid', apiKey: 'SG.key' })).toBe(true);
    expect(hasProviderCredentials({ provider: 'smtp', apiKey: 'SG.key' })).toBe(false);
    expect(hasProviderCredentials({ provider: 'smtp', smtp: { host: 'smtp.example.com' } })).toBe(true);
  });

  it('only Resend supports the built-in inbox', () => {
    expect(providerSupportsInbound({})).toBe(true);
    expect(providerSupportsInbound({ provider: 'resend' })).toBe(true);
    expect(providerSupportsInbound({ provider: 'postmark' })).toBe(false);
    expect(providerSupportsInbound({ provider: 'smtp' })).toBe(false);
  });

  it('resolves each provider id to its adapter with the right capabilities', () => {
    const sendgrid = resolveProvider({ provider: 'sendgrid', apiKey: 'SG.key' });
    expect(sendgrid.id).toBe('sendgrid');
    expect(sendgrid.capabilities.inbound).toBe(false);
    const smtp = resolveProvider({ provider: 'smtp', smtp: { host: 'smtp.example.com' } });
    expect(smtp.id).toBe('smtp');
  });
});

describe('SendGrid adapter', () => {
  it('sends via the v3 API and reads the id from x-message-id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { 'x-message-id': 'sg-123' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createSendGridProvider('SG.key').send(MESSAGE);
    expect(result).toEqual({ id: 'sg-123' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.personalizations).toEqual([{ to: [{ email: 'visitor@example.com' }] }]);
    expect(body.from).toEqual({ email: 'hello@site.com', name: 'Acme' });
    expect(body.reply_to).toEqual({ email: 'reply@site.com' });
    expect(body.content).toEqual([{ type: 'text/html', value: '<p>Hi</p>' }]);
    expect(body.headers).toEqual({ 'Message-Id': '<abc@site.com>' });
  });

  it('surfaces SendGrid error messages instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: 'The from address does not match a verified Sender' }] }), {
          status: 403,
        })
      )
    );
    const result = await createSendGridProvider('SG.key').send(MESSAGE);
    expect(result.error).toContain('verified Sender');
  });
});

describe('Postmark adapter', () => {
  it('sends via the Postmark API and returns MessageID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ MessageID: 'pm-456' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createPostmarkProvider('pm-token').send(MESSAGE);
    expect(result).toEqual({ id: 'pm-456' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Postmark-Server-Token': 'pm-token' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.From).toBe('Acme <hello@site.com>');
    expect(body.To).toBe('visitor@example.com');
    expect(body.HtmlBody).toBe('<p>Hi</p>');
    expect(body.Headers).toEqual([{ Name: 'Message-Id', Value: '<abc@site.com>' }]);
  });

  it('surfaces Postmark error messages instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ErrorCode: 300, Message: 'Invalid From address' }), { status: 422 })
      )
    );
    const result = await createPostmarkProvider('pm-token').send(MESSAGE);
    expect(result.error).toBe('Invalid From address');
  });
});
