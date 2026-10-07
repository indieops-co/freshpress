import { describe, it, expect } from 'vitest';
import { getUpgradeUrl } from './upgrade-url.js';

describe('getUpgradeUrl', () => {
  it('returns null when unset or blank', () => {
    expect(getUpgradeUrl({})).toBeNull();
    expect(getUpgradeUrl({ FRESHPRESS_CHECKOUT_URL: '   ' })).toBeNull();
  });

  it('returns a valid https URL (trimmed)', () => {
    expect(getUpgradeUrl({ FRESHPRESS_CHECKOUT_URL: '  https://store.freshpress.dev/checkout  ' })).toBe(
      'https://store.freshpress.dev/checkout'
    );
  });

  it('allows http as well as https', () => {
    expect(getUpgradeUrl({ FRESHPRESS_CHECKOUT_URL: 'http://localhost:9000/buy' })).toBe(
      'http://localhost:9000/buy'
    );
  });

  it('rejects non-http(s) schemes (no javascript:/data: in an href)', () => {
    expect(getUpgradeUrl({ FRESHPRESS_CHECKOUT_URL: 'javascript:alert(1)' })).toBeNull();
    expect(getUpgradeUrl({ FRESHPRESS_CHECKOUT_URL: 'data:text/html,x' })).toBeNull();
  });

  it('rejects a non-URL string', () => {
    expect(getUpgradeUrl({ FRESHPRESS_CHECKOUT_URL: 'not a url' })).toBeNull();
  });
});
