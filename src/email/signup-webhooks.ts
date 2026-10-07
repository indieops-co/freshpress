import { createHmac } from 'node:crypto';
import type { SignupWebhook, SiteMeta, Subscriber } from '../storage/types.js';
import { decryptWebhookSecret } from '../storage/signup-webhook-secrets.js';

/**
 * Outbound webhook delivery for subscriber events — the trigger seam that lets
 * users wire signups into external tools (Zapier, Instantly, a CRM) without
 * FreshPress integrating any of them. Payloads are HMAC-SHA256 signed with the
 * per-webhook secret; receivers verify `X-FreshPress-Signature`.
 *
 * Delivery is best-effort with bounded retries. It must never fail the visitor
 * flow that triggered it — callers fire-and-forget.
 */

export type SubscriberEvent = 'subscriber.confirmed' | 'subscriber.unsubscribed';

export interface SubscriberEventPayload {
  event: SubscriberEvent;
  siteId: string;
  siteName: string;
  subscriber: {
    id: string;
    email: string;
    name?: string;
    pagePath?: string;
    createdAt: string;
    confirmedAt?: string;
    unsubscribedAt?: string;
  };
  timestamp: string;
}

/** Public fields only — the subscriber's tokens must never leave the server. */
export function buildSubscriberPayload(
  meta: Pick<SiteMeta, 'id' | 'name'>,
  event: SubscriberEvent,
  subscriber: Subscriber,
  now = new Date().toISOString()
): SubscriberEventPayload {
  return {
    event,
    siteId: meta.id,
    siteName: meta.name,
    subscriber: {
      id: subscriber.id,
      email: subscriber.email,
      ...(subscriber.name ? { name: subscriber.name } : {}),
      ...(subscriber.pagePath ? { pagePath: subscriber.pagePath } : {}),
      createdAt: subscriber.createdAt,
      ...(subscriber.confirmedAt ? { confirmedAt: subscriber.confirmedAt } : {}),
      ...(subscriber.unsubscribedAt ? { unsubscribedAt: subscriber.unsubscribedAt } : {}),
    },
    timestamp: now,
  };
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

export interface DispatchOptions {
  fetchImpl?: typeof fetch;
  /** Delay before each attempt (ms); length = max attempts. Injectable so tests run instantly. */
  retryDelaysMs?: number[];
  timeoutMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS = [0, 1_000, 5_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverWithRetry(
  hook: SignupWebhook,
  event: SubscriberEvent,
  body: string,
  opts?: DispatchOptions
): Promise<boolean> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const delays = opts?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const signature = signWebhookBody(decryptWebhookSecret(hook.secret), body);

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    try {
      const res = await fetchImpl(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FreshPress-Event': event,
          'X-FreshPress-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 10_000),
      });
      if (res.ok) return true;
      console.error(`Signup webhook ${hook.url} responded ${res.status} (attempt ${attempt + 1}/${delays.length})`);
    } catch (err) {
      console.error(
        `Signup webhook ${hook.url} failed (attempt ${attempt + 1}/${delays.length}):`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return false;
}

/** Fire every enabled webhook for one subscriber event. Never throws. */
export async function dispatchSubscriberEvent(
  meta: SiteMeta,
  event: SubscriberEvent,
  subscriber: Subscriber,
  opts?: DispatchOptions
): Promise<void> {
  const hooks = (meta.signupWebhooks ?? []).filter((h) => h.enabled);
  if (hooks.length === 0) return;

  const body = JSON.stringify(buildSubscriberPayload(meta, event, subscriber));
  await Promise.all(hooks.map((hook) => deliverWithRetry(hook, event, body, opts)));
}
