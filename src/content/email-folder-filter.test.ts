import { describe, it, expect } from 'vitest';
import { matchesFilterRule } from './email-folder-filter.js';

describe('matchesFilterRule', () => {
  it('matches a keyword rule case-insensitively against the subject', () => {
    const rule = { matchType: 'keyword' as const, value: 'invoice' };
    expect(matchesFilterRule(rule, { subject: 'Your INVOICE is ready', senderEmail: 'a@b.com' })).toBe(true);
    expect(matchesFilterRule(rule, { subject: 'Hello there', senderEmail: 'a@b.com' })).toBe(false);
  });

  it('matches a senderDomain rule case-insensitively against the sender', () => {
    const rule = { matchType: 'senderDomain' as const, value: 'clientdomain.com' };
    expect(matchesFilterRule(rule, { subject: 'Hi', senderEmail: 'lead@ClientDomain.com' })).toBe(true);
    expect(matchesFilterRule(rule, { subject: 'Hi', senderEmail: 'lead@other.com' })).toBe(false);
  });

  it('does not match senderDomain as a substring of a different domain', () => {
    const rule = { matchType: 'senderDomain' as const, value: 'domain.com' };
    expect(matchesFilterRule(rule, { subject: 'Hi', senderEmail: 'lead@notdomain.com' })).toBe(false);
  });
});
