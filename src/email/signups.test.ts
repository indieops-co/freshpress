import { describe, it, expect } from 'vitest';
import { applySignup, buildConfirmUrl, buildUnsubscribeUrl, confirmSubscriber, unsubscribeSubscriber } from './signups.js';
import type { Subscriber } from '../storage/types.js';

const NOW = '2026-09-07T12:00:00.000Z';

function pending(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    id: 'sub1',
    siteId: 'site1',
    email: 'a@b.com',
    status: 'pending',
    confirmToken: 'confirm-old',
    unsubscribeToken: 'unsub-1',
    createdAt: NOW,
    ...overrides,
  };
}

describe('applySignup', () => {
  it('creates a pending subscriber with lowercased email and both tokens', () => {
    const outcome = applySignup(null, 'site1', { email: '  Visitor@Example.COM ', name: ' Ada ' }, NOW);
    expect(outcome.action).toBe('created');
    const s = outcome.subscriber;
    expect(s.email).toBe('visitor@example.com');
    expect(s.name).toBe('Ada');
    expect(s.status).toBe('pending');
    expect(s.confirmToken).toBeTruthy();
    expect(s.unsubscribeToken).toBeTruthy();
    expect(s.confirmToken).not.toBe(s.unsubscribeToken);
    expect(s.createdAt).toBe(NOW);
  });

  it('is idempotent for a confirmed subscriber — nothing changes, nothing to send', () => {
    const confirmed = pending({ status: 'confirmed', confirmToken: undefined });
    const outcome = applySignup(confirmed, 'site1', { email: 'a@b.com' }, NOW);
    expect(outcome.action).toBe('already-confirmed');
    expect(outcome.subscriber).toBe(confirmed);
  });

  it('re-issues a fresh confirm token for a pending repeat signup', () => {
    const outcome = applySignup(pending(), 'site1', { email: 'a@b.com' }, NOW);
    expect(outcome.action).toBe('reconfirm');
    expect(outcome.subscriber.confirmToken).toBeTruthy();
    expect(outcome.subscriber.confirmToken).not.toBe('confirm-old');
    expect(outcome.subscriber.unsubscribeToken).toBe('unsub-1');
  });

  it('lets an unsubscribed visitor opt back in only via a new double opt-in', () => {
    const outcome = applySignup(pending({ status: 'unsubscribed', unsubscribedAt: NOW }), 'site1', { email: 'a@b.com' }, NOW);
    expect(outcome.action).toBe('reconfirm');
    expect(outcome.subscriber.status).toBe('pending');
  });
});

describe('confirm / unsubscribe transitions', () => {
  it('confirm drops the single-use token (key removed, not undefined)', () => {
    const confirmed = confirmSubscriber(pending(), NOW);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).toBe(NOW);
    expect('confirmToken' in confirmed).toBe(false);
    expect(confirmed.unsubscribeToken).toBe('unsub-1');
  });

  it('unsubscribe stamps the time and drops any live confirm token', () => {
    const unsubscribed = unsubscribeSubscriber(pending(), NOW);
    expect(unsubscribed.status).toBe('unsubscribed');
    expect(unsubscribed.unsubscribedAt).toBe(NOW);
    expect('confirmToken' in unsubscribed).toBe(false);
  });
});

describe('link builders', () => {
  it('build the public confirm/unsubscribe URLs without double slashes', () => {
    expect(buildConfirmUrl('site1', 'https://app.example.com/', 'tok')).toBe(
      'https://app.example.com/api/public/sites/site1/subscribe/confirm?token=tok'
    );
    expect(buildUnsubscribeUrl('site1', 'https://app.example.com', 'tok')).toBe(
      'https://app.example.com/api/public/sites/site1/unsubscribe?token=tok'
    );
  });
});
