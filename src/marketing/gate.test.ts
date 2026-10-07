import { describe, it, expect } from 'vitest';
import { marketingEnabled } from './gate.js';

/**
 * The root-route gate matrix. Buyer instances (HOSTED=1, no demo flags) and
 * bare self-hosted installs must never serve FreshPress marketing at '/';
 * the demo instance gets it by default; MARKETING_SITE overrides both ways.
 */
describe('marketingEnabled', () => {
  it.each<[NodeJS.ProcessEnv, boolean]>([
    [{ DEMO_MODE: '1' }, true],
    [{ MARKETING_SITE: '1' }, true],
    [{ MARKETING_SITE: '1', DEMO_MODE: '0' }, true],
    [{ DEMO_MODE: '1', MARKETING_SITE: '0' }, false],
    [{ MARKETING_SITE: '0' }, false],
    [{ HOSTED: '1' }, false],
    [{ DEMO_MODE: '0' }, false],
    [{}, false],
  ])('%o → %s', (env, expected) => {
    expect(marketingEnabled(env)).toBe(expected);
  });
});
