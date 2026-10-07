/**
 * Feature entitlements — the single gating point for plan-tier features and limits.
 *
 * minTiers are baked in here (open-core: the gates are public; the paid overlay's job
 * is raising the workspace tier via licensing, never loosening gates). Per-deployment
 * env overrides may only TIGHTEN or DISABLE:
 *   FEATURE_<NAME>=off|free|pro|agency — effective minTier is max(configured, env);
 *     values that would lower the configured minTier are ignored with a warning.
 *   LIMIT_<NAME>=<n> — effective limit is min(configured, env).
 */
import type { NextFunction, Request, Response } from 'express';
import { PlanTierSchema, type PlanTier } from './types.js';

const TIER_ORDER: Record<PlanTier, number> = { free: 0, pro: 1, agency: 2 };

export type FeatureKey =
  | 'deepBrandResearch'
  | 'designPowerpack'
  | 'emailSystem'
  | 'wordpressConnector'
  | 'removeWatermark'
  | 'whiteLabel';

export const FEATURES: Record<FeatureKey, { minTier: PlanTier; envVar: string }> = {
  deepBrandResearch: { minTier: 'pro', envVar: 'FEATURE_DEEP_BRAND_RESEARCH' },
  designPowerpack: { minTier: 'free', envVar: 'FEATURE_DESIGN_POWERPACK' },
  emailSystem: { minTier: 'pro', envVar: 'FEATURE_EMAIL_SYSTEM' },
  wordpressConnector: { minTier: 'pro', envVar: 'FEATURE_WORDPRESS_CONNECTOR' },
  removeWatermark: { minTier: 'pro', envVar: 'FEATURE_REMOVE_WATERMARK' },
  whiteLabel: { minTier: 'agency', envVar: 'FEATURE_WHITE_LABEL' },
};

const warnedLoosening = new Set<string>();

/** Effective minimum tier for a feature, or null when the env override disables it outright. */
function effectiveMinTier(feature: FeatureKey): PlanTier | null {
  const config = FEATURES[feature];
  const raw = process.env[config.envVar]?.trim().toLowerCase();
  if (!raw) return config.minTier;
  if (raw === 'off') return null;
  const parsed = PlanTierSchema.safeParse(raw === 'all' ? 'free' : raw);
  if (!parsed.success) return config.minTier;
  if (TIER_ORDER[parsed.data] < TIER_ORDER[config.minTier]) {
    if (!warnedLoosening.has(config.envVar)) {
      warnedLoosening.add(config.envVar);
      console.warn(
        `entitlements: ${config.envVar}=${raw} would loosen ${feature} below its ` +
          `configured minTier '${config.minTier}' — ignored (env may only tighten).`
      );
    }
    return config.minTier;
  }
  return parsed.data;
}

export function hasFeature(planTier: PlanTier | undefined, feature: FeatureKey): boolean {
  const minTier = effectiveMinTier(feature);
  if (minTier === null) return false;
  // Undefined tier only occurs for master-key auth on a workspace-less install (sessions
  // always carry the workspace's tier, which defaults to 'free'). The break-glass admin
  // must never be locked out by a paid flip, so undefined passes any tier gate.
  if (planTier === undefined) return true;
  return TIER_ORDER[planTier] >= TIER_ORDER[minTier];
}

/** All feature flags for a tier — the /auth/me payload the editor gates its UI on. */
export function featureFlags(planTier: PlanTier | undefined): Record<FeatureKey, boolean> {
  return Object.fromEntries(
    (Object.keys(FEATURES) as FeatureKey[]).map((key) => [key, hasFeature(planTier, key)])
  ) as Record<FeatureKey, boolean>;
}

/** Express gate: 403 with an upgrade-shaped error when the workspace lacks the feature. */
export function requireFeature(feature: FeatureKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hasFeature(req.auth?.planTier, feature)) {
      res.status(403).json({
        error: 'This feature is not available on your plan.',
        feature,
        upgradeRequired: true,
      });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Numeric limits — quantity entitlements (how many, not whether).
// ---------------------------------------------------------------------------

export type LimitKey = 'clientSites' | 'emailAutomationsPerSite';

/** Per-tier limits. Numbers are launch placeholders — env may lower, never raise. */
export const LIMITS: Record<LimitKey, { tiers: Record<PlanTier, number>; envVar: string }> = {
  clientSites: {
    tiers: { free: 1, pro: 5, agency: 50 },
    envVar: 'LIMIT_CLIENT_SITES',
  },
  emailAutomationsPerSite: {
    tiers: { free: 0, pro: 3, agency: 20 },
    envVar: 'LIMIT_EMAIL_AUTOMATIONS_PER_SITE',
  },
};

/**
 * Effective limit for a tier. Undefined tier (master-key break-glass) is unlimited,
 * mirroring hasFeature's undefined-tier behavior.
 */
export function getLimit(planTier: PlanTier | undefined, key: LimitKey): number {
  if (planTier === undefined) return Infinity;
  const config = LIMITS[key];
  const configured = config.tiers[planTier];
  const raw = process.env[config.envVar]?.trim();
  if (!raw) return configured;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return configured;
  return Math.min(configured, parsed);
}

/** Thrown by assertUnderLimit; route handlers translate it via its status/body. */
export class LimitExceededError extends Error {
  readonly status = 409;
  readonly body: { error: string; feature: LimitKey; limit: number; upgradeRequired: true };

  constructor(key: LimitKey, limit: number) {
    super(`Plan limit reached: ${key} allows ${limit} on this plan.`);
    this.name = 'LimitExceededError';
    this.body = { error: this.message, feature: key, limit, upgradeRequired: true };
  }
}

/** Guard for create-routes: throws an upgrade-shaped 409 when the tier's limit is used up. */
export function assertUnderLimit(
  planTier: PlanTier | undefined,
  key: LimitKey,
  currentCount: number
): void {
  const limit = getLimit(planTier, key);
  if (currentCount >= limit) throw new LimitExceededError(key, limit);
}

/**
 * Full entitlements payload for /auth/me — flags plus limits, so the editor can gate
 * UI and render usage/upgrade CTAs. Unlimited (master-key) serializes as null.
 */
export function entitlements(planTier: PlanTier | undefined): {
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number | null>;
} {
  return {
    features: featureFlags(planTier),
    limits: Object.fromEntries(
      (Object.keys(LIMITS) as LimitKey[]).map((key) => {
        const limit = getLimit(planTier, key);
        return [key, Number.isFinite(limit) ? limit : null];
      })
    ) as Record<LimitKey, number | null>,
  };
}
