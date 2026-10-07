import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  FEATURES,
  LIMITS,
  LimitExceededError,
  assertUnderLimit,
  entitlements,
  featureFlags,
  getLimit,
  hasFeature,
  requireFeature,
} from './entitlements.js';

const BRAND_ENV = FEATURES.deepBrandResearch.envVar;
const POWERPACK_ENV = FEATURES.designPowerpack.envVar;
const SITES_ENV = LIMITS.clientSites.envVar;

describe('entitlements — feature gates', () => {
  afterEach(() => {
    delete process.env[BRAND_ENV];
    delete process.env[POWERPACK_ENV];
  });

  it('baked minTiers: pro features are off for free, on for pro+', () => {
    for (const key of ['deepBrandResearch', 'emailSystem', 'wordpressConnector', 'removeWatermark'] as const) {
      expect(hasFeature('free', key)).toBe(false);
      expect(hasFeature('pro', key)).toBe(true);
      expect(hasFeature('agency', key)).toBe(true);
    }
  });

  it('whiteLabel is agency-only; designPowerpack is free for everyone', () => {
    expect(hasFeature('pro', 'whiteLabel')).toBe(false);
    expect(hasFeature('agency', 'whiteLabel')).toBe(true);
    expect(hasFeature('free', 'designPowerpack')).toBe(true);
  });

  it('env override "off" disables the feature for all tiers', () => {
    process.env[BRAND_ENV] = 'off';
    expect(hasFeature('agency', 'deepBrandResearch')).toBe(false);
  });

  it('env may tighten: a free feature can be raised to pro per-deployment', () => {
    process.env[POWERPACK_ENV] = 'pro';
    expect(hasFeature('free', 'designPowerpack')).toBe(false);
    expect(hasFeature('pro', 'designPowerpack')).toBe(true);
  });

  it('env may NOT loosen: "all"/"free" on a pro feature is ignored', () => {
    process.env[BRAND_ENV] = 'all';
    expect(hasFeature('free', 'deepBrandResearch')).toBe(false);
    process.env[BRAND_ENV] = 'free';
    expect(hasFeature('free', 'deepBrandResearch')).toBe(false);
    expect(hasFeature('pro', 'deepBrandResearch')).toBe(true);
  });

  it('unknown env values fall back to the configured minTier', () => {
    process.env[BRAND_ENV] = 'banana';
    expect(hasFeature('free', 'deepBrandResearch')).toBe(false);
    expect(hasFeature('pro', 'deepBrandResearch')).toBe(true);
  });

  it('undefined tier (master-key break-glass) passes tier gates but not "off"', () => {
    expect(hasFeature(undefined, 'deepBrandResearch')).toBe(true);
    expect(hasFeature(undefined, 'whiteLabel')).toBe(true);
    process.env[BRAND_ENV] = 'off';
    expect(hasFeature(undefined, 'deepBrandResearch')).toBe(false);
  });

  it('featureFlags carries every FeatureKey and mirrors hasFeature', () => {
    const flags = featureFlags('free');
    expect(Object.keys(flags).sort()).toEqual(Object.keys(FEATURES).sort());
    expect(flags).toMatchObject({
      deepBrandResearch: false,
      designPowerpack: true,
      emailSystem: false,
      wordpressConnector: false,
      removeWatermark: false,
      whiteLabel: false,
    });
    expect(featureFlags('pro').whiteLabel).toBe(false);
    expect(featureFlags('agency').whiteLabel).toBe(true);
  });
});

describe('entitlements — numeric limits', () => {
  afterEach(() => {
    delete process.env[SITES_ENV];
  });

  it('returns the configured per-tier limit', () => {
    expect(getLimit('free', 'clientSites')).toBe(LIMITS.clientSites.tiers.free);
    expect(getLimit('pro', 'clientSites')).toBe(LIMITS.clientSites.tiers.pro);
    expect(getLimit('free', 'emailAutomationsPerSite')).toBe(0);
  });

  it('undefined tier (master-key break-glass) is unlimited', () => {
    expect(getLimit(undefined, 'clientSites')).toBe(Infinity);
  });

  it('env may lower a limit but never raise it; junk is ignored', () => {
    process.env[SITES_ENV] = '2';
    expect(getLimit('pro', 'clientSites')).toBe(2);
    process.env[SITES_ENV] = '999';
    expect(getLimit('free', 'clientSites')).toBe(LIMITS.clientSites.tiers.free);
    process.env[SITES_ENV] = 'lots';
    expect(getLimit('pro', 'clientSites')).toBe(LIMITS.clientSites.tiers.pro);
    process.env[SITES_ENV] = '-1';
    expect(getLimit('pro', 'clientSites')).toBe(LIMITS.clientSites.tiers.pro);
  });

  it('assertUnderLimit passes below the limit and throws an upgrade-shaped 409 at it', () => {
    expect(() => assertUnderLimit('pro', 'clientSites', 0)).not.toThrow();
    const limit = getLimit('free', 'clientSites');
    try {
      assertUnderLimit('free', 'clientSites', limit);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LimitExceededError);
      const e = err as LimitExceededError;
      expect(e.status).toBe(409);
      expect(e.body).toMatchObject({
        feature: 'clientSites',
        limit,
        upgradeRequired: true,
      });
    }
    expect(() => assertUnderLimit(undefined, 'clientSites', 10_000)).not.toThrow();
  });

  it('requireFeature middleware 403s free-tier requests with an upgrade body and passes pro', () => {
    const gate = requireFeature('emailSystem');
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
    const next = vi.fn() as NextFunction;

    gate({ auth: { role: 'admin', planTier: 'free' } } as unknown as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'emailSystem', upgradeRequired: true })
    );
    expect(next).not.toHaveBeenCalled();

    gate({ auth: { role: 'admin', planTier: 'pro' } } as unknown as Request, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('entitlements() bundles flags and limits; unlimited serializes as null', () => {
    const free = entitlements('free');
    expect(free.features.emailSystem).toBe(false);
    expect(free.limits.clientSites).toBe(LIMITS.clientSites.tiers.free);
    const breakGlass = entitlements(undefined);
    expect(breakGlass.limits.clientSites).toBeNull();
    expect(JSON.parse(JSON.stringify(breakGlass)).limits.clientSites).toBeNull();
  });
});
