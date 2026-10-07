import { nanoid } from 'nanoid';
import type { Subscriber } from '../storage/types.js';

/**
 * Pure double-opt-in state transitions for email signups. Routes load/save via
 * the StorageAdapter; everything decision-shaped lives here so it unit-tests
 * without storage or network.
 */

export interface SignupInput {
  email: string;
  name?: string;
  pagePath?: string;
}

export type SignupOutcome =
  /** New subscriber, or a pending/unsubscribed one re-invited — send the confirmation email. */
  | { action: 'created' | 'reconfirm'; subscriber: Subscriber }
  /** Idempotent repeat signup — nothing to store or send. */
  | { action: 'already-confirmed'; subscriber: Subscriber };

export function applySignup(
  existing: Subscriber | null,
  siteId: string,
  input: SignupInput,
  now = new Date().toISOString()
): SignupOutcome {
  if (existing) {
    if (existing.status === 'confirmed') {
      return { action: 'already-confirmed', subscriber: existing };
    }
    // pending → fresh confirm link; unsubscribed → allowed to opt back in, but
    // only via a new double opt-in (never silently resurrected).
    return {
      action: 'reconfirm',
      subscriber: {
        ...existing,
        status: 'pending',
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.pagePath ? { pagePath: input.pagePath } : {}),
        confirmToken: nanoid(24),
      },
    };
  }

  return {
    action: 'created',
    subscriber: {
      id: nanoid(12),
      siteId,
      email: input.email.trim().toLowerCase(),
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.pagePath ? { pagePath: input.pagePath } : {}),
      status: 'pending',
      confirmToken: nanoid(24),
      unsubscribeToken: nanoid(24),
      createdAt: now,
    },
  };
}

/** confirmToken is single-use: the key is dropped (not set undefined) so storage actually removes it. */
export function confirmSubscriber(subscriber: Subscriber, now = new Date().toISOString()): Subscriber {
  const { confirmToken: _confirmToken, ...rest } = subscriber;
  return { ...rest, status: 'confirmed', confirmedAt: now };
}

export function unsubscribeSubscriber(subscriber: Subscriber, now = new Date().toISOString()): Subscriber {
  const { confirmToken: _confirmToken, ...rest } = subscriber;
  return { ...rest, status: 'unsubscribed', unsubscribedAt: now };
}

export function buildConfirmUrl(siteId: string, appUrl: string, confirmToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/public/sites/${siteId}/subscribe/confirm?token=${confirmToken}`;
}

export function buildUnsubscribeUrl(siteId: string, appUrl: string, unsubscribeToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/public/sites/${siteId}/unsubscribe?token=${unsubscribeToken}`;
}
