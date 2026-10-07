import { describe, it, expect, afterEach } from 'vitest';
import { shouldRunCritique, shouldIncludeSignup, withPreviewHtml } from './site-generation.js';
import { FEATURES } from '../auth/entitlements.js';
import type { PlanTier } from '../auth/types.js';
import { buildGeneratedPage, selectIncludedSections } from '../ai/generate-page-content.js';
import { selectScaffold, rankScaffolds } from '../design/section-patterns.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';
import { planDirections, type GeneratedDirection } from '../ai/generate-site-directions.js';

const ENV = FEATURES.designPowerpack.envVar;
const EMAIL_ENV = FEATURES.emailSystem.envVar;

/**
 * The /generate critique gating matrix: entitlement (designPowerpack) AND
 * explicit request flag (`critique: true`). The AI call itself is a thin
 * wrapper (critique-direction.ts) — this pure gate is what decides whether
 * any extra AI calls happen at all.
 */
describe('shouldRunCritique', () => {
  afterEach(() => {
    delete process.env[ENV];
  });

  it('runs only when entitled AND explicitly requested', () => {
    expect(shouldRunCritique('free', { critique: true })).toBe(true);
  });

  it('does not run without the request flag, even when entitled', () => {
    expect(shouldRunCritique('free', {})).toBe(false);
    expect(shouldRunCritique('free', { critique: false })).toBe(false);
    expect(shouldRunCritique('free', { critique: 'true' })).toBe(false);
    expect(shouldRunCritique('free', undefined)).toBe(false);
  });

  it('does not run when the feature is disabled, even when requested', () => {
    process.env[ENV] = 'off';
    expect(shouldRunCritique('agency', { critique: true })).toBe(false);
  });

  it('honors the future paid flip via env tier override', () => {
    process.env[ENV] = 'pro';
    expect(shouldRunCritique('free', { critique: true })).toBe(false);
    expect(shouldRunCritique('pro', { critique: true })).toBe(true);
  });
});

/**
 * The newsletter-signup gating matrix: entitlement (emailSystem, Pro) AND
 * explicit request flag (`includeSignup: true`). It is the only switch for the
 * opt-in SignupForm section, so it decides whether any direction gets a form.
 */
describe('shouldIncludeSignup', () => {
  afterEach(() => {
    delete process.env[EMAIL_ENV];
  });

  it('is off for a default request on every tier', () => {
    for (const tier of ['free', 'pro', 'agency', undefined] as const) {
      expect(shouldIncludeSignup(tier, {})).toBe(false);
    }
    expect(shouldIncludeSignup('pro', { includeSignup: false })).toBe(false);
    expect(shouldIncludeSignup('pro', { includeSignup: 'true' })).toBe(false);
    expect(shouldIncludeSignup('pro', undefined)).toBe(false);
  });

  it('is on when requested AND the plan has the email system', () => {
    expect(shouldIncludeSignup('pro', { includeSignup: true })).toBe(true);
    expect(shouldIncludeSignup('agency', { includeSignup: true })).toBe(true);
  });

  it('is off when requested but not entitled (free tier, or the feature disabled)', () => {
    expect(shouldIncludeSignup('free', { includeSignup: true })).toBe(false);
    process.env[EMAIL_ENV] = 'off';
    expect(shouldIncludeSignup('agency', { includeSignup: true })).toBe(false);
  });

  it('decides whether the planned directions carry a SignupForm', () => {
    const [base, ...adjacents] = rankScaffolds('service-business');
    const signupPerDirection = (tier: PlanTier, body: unknown) =>
      planDirections(base, adjacents, 3, shouldIncludeSignup(tier, body)).map((p) => p.fingerprint.includes('SignupForm'));
    expect(signupPerDirection('pro', {})).toEqual([false, false, false]);
    expect(signupPerDirection('pro', { includeSignup: true })).toEqual([true, true, true]);
    expect(signupPerDirection('free', { includeSignup: true })).toEqual([false, false, false]);
  });
});

/**
 * Chunk 9: every direction the /generate endpoint returns carries its full
 * themed HTML so the wizard's picker can iframe a live preview without a
 * round-trip per direction.
 */
describe('withPreviewHtml', () => {
  const saas = selectScaffold('saas').scaffold;
  const direction = (): GeneratedDirection => {
    const content = buildGeneratedPage(
      selectIncludedSections(saas, {
        sections: saas.sections.map((s) => ({ id: s.id, include: true, fields: {}, items: [] })),
      }),
      1
    );
    return {
      index: 0,
      scaffoldId: saas.id,
      scaffoldName: saas.name,
      directive: 'the most complete layout',
      fingerprint: [],
      valid: true,
      errors: [],
      page: { path: '/', title: 'Acme — Home', content },
    };
  };
  const guide = buildDefaultStyleGuide('test', 'Test Theme', 'Testing Aesthetic');

  it('stamps each direction with themed, slot-rendered HTML', () => {
    const [d] = withPreviewHtml([direction()], guide);
    expect(d.previewHtml).toContain('<style data-fp-theme>');
    expect(d.previewHtml).toContain('fp-page');
    // Slots are rendered, not left as placeholders.
    expect(d.previewHtml).not.toContain('{{slot:');
  });

  it('does not mutate the input directions', () => {
    const input = direction();
    withPreviewHtml([input], guide);
    expect(input.previewHtml).toBeUndefined();
  });
});
