import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildSubscriberPayload, dispatchSubscriberEvent, signWebhookBody } from './signup-webhooks.js';
import { encryptWebhookSecret } from '../storage/signup-webhook-secrets.js';
import type { SiteMeta, Subscriber } from '../storage/types.js';

const NOW = '2026-09-07T12:00:00.000Z';

const SUBSCRIBER: Subscriber = {
  id: 'sub1',
  siteId: 'site1',
  email: 'a@b.com',
  name: 'Ada',
  status: 'confirmed',
  unsubscribeToken: 'unsub-secret-token',
  createdAt: NOW,
  confirmedAt: NOW,
};

function siteMeta(overrides: Partial<SiteMeta> = {}): SiteMeta {
  return { id: 'site1', name: 'Acme', createdAt: NOW, updatedAt: NOW, ...overrides };
}

const prevMaster = process.env.MASTER_KEY;
beforeEach(() => {
  process.env.MASTER_KEY = 'test-master-key-for-webhooks';
  delete process.env.KEY_ENCRYPTION_SECRET;
});
afterEach(() => {
  if (prevMaster === undefined) delete process.env.MASTER_KEY;
  else process.env.MASTER_KEY = prevMaster;
});

describe('buildSubscriberPayload', () => {
  it('exposes public subscriber fields and never the tokens', () => {
    const payload = buildSubscriberPayload(siteMeta(), 'subscriber.confirmed', SUBSCRIBER, NOW);
    expect(payload).toEqual({
      event: 'subscriber.confirmed',
      siteId: 'site1',
      siteName: 'Acme',
      subscriber: { id: 'sub1', email: 'a@b.com', name: 'Ada', createdAt: NOW, confirmedAt: NOW },
      timestamp: NOW,
    });
    expect(JSON.stringify(payload)).not.toContain('unsub-secret-token');
  });
});

describe('signWebhookBody', () => {
  it('produces a sha256= HMAC hex digest of the exact body', () => {
    const body = '{"hello":"world"}';
    const expected = `sha256=${createHmac('sha256', 'secret1').update(body, 'utf8').digest('hex')}`;
    expect(signWebhookBody('secret1', body)).toBe(expected);
  });
});

describe('dispatchSubscriberEvent', () => {
  const hook = (overrides = {}) => ({
    id: 'wh1',
    url: 'https://hooks.example.com/a',
    secret: encryptWebhookSecret('whsec_test'),
    enabled: true,
    createdAt: NOW,
    ...overrides,
  });

  it('POSTs a signed payload to every enabled webhook and skips disabled ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const meta = siteMeta({
      signupWebhooks: [hook(), hook({ id: 'wh2', url: 'https://hooks.example.com/b', enabled: false })],
    });

    await dispatchSubscriberEvent(meta, 'subscriber.confirmed', SUBSCRIBER, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/a');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-FreshPress-Event']).toBe('subscriber.confirmed');
    // Signature is verifiable with the plaintext secret the owner was shown at creation.
    expect(headers['X-FreshPress-Signature']).toBe(signWebhookBody('whsec_test', (init as RequestInit).body as string));
  });

  it('retries failed deliveries up to the delay-schedule length', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await dispatchSubscriberEvent(siteMeta({ signupWebhooks: [hook()] }), 'subscriber.confirmed', SUBSCRIBER, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0, 0, 0],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when every attempt fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(
      dispatchSubscriberEvent(siteMeta({ signupWebhooks: [hook()] }), 'subscriber.unsubscribed', SUBSCRIBER, {
        fetchImpl: fetchMock as unknown as typeof fetch,
        retryDelaysMs: [0, 0],
      })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op with no webhooks configured', async () => {
    const fetchMock = vi.fn();
    await dispatchSubscriberEvent(siteMeta(), 'subscriber.confirmed', SUBSCRIBER, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
