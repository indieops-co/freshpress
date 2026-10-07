import { Router } from 'express';
import { requireOwner } from '../auth/middleware.js';
import { hasFeature } from '../auth/entitlements.js';
import type { PlanTier } from '../auth/types.js';
import { routeParam } from '../util/params.js';
import { getStorage } from '../storage/filesystem.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { getBrandResearchStore } from '../storage/brand-research.js';
import { buildBrandVoiceContext } from '../content/brand-voice-context.js';
import { resolveAiKeys } from '../integrations/resolve.js';
import { rankScaffolds } from '../design/section-patterns.js';
import { generateSiteDirections, type GeneratedDirection } from '../ai/generate-site-directions.js';
import { critiqueDirection } from '../ai/critique-direction.js';
import type { GenerationContext } from '../ai/generate-page-content.js';
import { renderPage } from '../content/render.js';
import type { StyleGuide } from '../design/style-guide.js';

const router = Router();

/**
 * Design Powerpack gate: the entitlement makes the critique AVAILABLE; the
 * request's explicit `critique: true` makes it RUN. During the feature-flag
 * era every tier has the entitlement, so the opt-in flag is what keeps the
 * 1–3 extra AI calls off the default path. Pure — unit-tested as the
 * endpoint's gating matrix.
 */
export function shouldRunCritique(planTier: PlanTier | undefined, body: unknown): boolean {
  const requested = !!body && typeof body === 'object' && (body as { critique?: unknown }).critique === true;
  return requested && hasFeature(planTier, 'designPowerpack');
}

/**
 * Newsletter-signup gate, same shape as shouldRunCritique: the emailSystem
 * entitlement makes the opt-in SignupForm section AVAILABLE; the request's
 * explicit `includeSignup: true` puts it on every direction. Off by default, so
 * free sites (email is Pro) never get a form that can't collect anyone. Pure.
 */
export function shouldIncludeSignup(planTier: PlanTier | undefined, body: unknown): boolean {
  const requested = !!body && typeof body === 'object' && (body as { includeSignup?: unknown }).includeSignup === true;
  return requested && hasFeature(planTier, 'emailSystem');
}

/**
 * Chunk 9 (Phase 7a) — stamp each direction with its full themed HTML so the
 * wizard's picker can iframe a live preview (decision #5) without re-fetching
 * per direction. Pure over renderPage — unit-tested directly.
 */
export function withPreviewHtml(directions: GeneratedDirection[], guide: StyleGuide): GeneratedDirection[] {
  return directions.map((d) => ({ ...d, previewHtml: renderPage(d.page.content, guide) }));
}

/**
 * POST /sites/:siteId/generate
 * Chunk 8: generate 1–3 divergent home-page directions grounded in the site's ACTIVE StyleGuide
 * (must exist first — open-question #4) and a curated industry scaffold (Chunk 7). Returns the
 * directions for review; it does NOT persist pages — the Phase-7 wizard applies the chosen one
 * atomically. Distinct from POST /design/generate, which generates the *StyleGuide*.
 */
router.post('/sites/:siteId/generate', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const body = req.body as {
      brandName?: string;
      industry?: string;
      personality?: string[];
      targetAudience?: string;
      moodKeywords?: string[];
      count?: number;
      critique?: boolean;
      includeSignup?: boolean;
    };
    if (!body?.brandName?.trim()) {
      res.status(400).json({ error: 'brandName is required' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    // Q4: the generator reads the active StyleGuide, so it must exist first.
    const guideStore = await getStyleGuideStore();
    const guide = await guideStore.get(siteId);
    if (!guide) {
      res.status(409).json({ error: 'This site has no active theme yet. Apply or generate a Site Theme first, then generate pages.' });
      return;
    }

    const credentials = await resolveAiKeys();
    if (!credentials) {
      res.status(400).json({ error: 'No AI provider configured. Add an Anthropic or OpenRouter key in Admin → Integrations.' });
      return;
    }

    const personality = Array.isArray(body.personality) ? body.personality : [];
    const moodKeywords = Array.isArray(body.moodKeywords) ? body.moodKeywords : [];
    const count = Math.max(1, Math.min(3, Number(body.count) || 1));

    // Approved Deep Brand Research (if the site has any) sharpens the copy. Best-effort.
    let brandResearchContext: string | undefined;
    try {
      const research = await (await getBrandResearchStore()).get(siteId);
      brandResearchContext = buildBrandVoiceContext({ brandResearch: research });
    } catch {
      // enrichment is optional — never block generation on it
    }

    const scaffolds = rankScaffolds(body.industry, personality, moodKeywords);
    const ctx: GenerationContext = {
      brandName: body.brandName.trim(),
      industry: body.industry,
      personality,
      targetAudience: body.targetAudience,
      moodKeywords,
      designDirection: guide.aiSystemPromptAddition,
      brandResearch: brandResearchContext,
      designRules: guide.designRules || undefined,
    };

    const directions = await generateSiteDirections({
      scaffolds,
      ctx,
      count,
      credentials,
      includeOptIn: shouldIncludeSignup(req.auth?.planTier, body),
    });

    // Design Powerpack: entitled + explicitly requested. Best-effort per
    // direction — a failed or unparseable critique leaves that direction
    // without the optional field; it must never fail generation.
    if (shouldRunCritique(req.auth?.planTier, body)) {
      await Promise.all(
        directions.map(async (direction) => {
          try {
            const critique = await critiqueDirection(
              { direction, designRules: guide.designRules || undefined, aesthetic: guide.meta.aesthetic },
              credentials
            );
            if (critique) direction.critique = critique;
          } catch (err) {
            console.warn(`[generate] critique failed for direction ${direction.index}:`, err);
          }
        })
      );
    }

    // A requested-but-not-entitled critique must be distinguishable from a
    // failed one (after the paid flip, stale UIs would otherwise see the
    // feature silently vanish instead of an upgrade cue).
    const critiqueSkipped =
      body.critique === true && !shouldRunCritique(req.auth?.planTier, body)
        ? ('not_entitled' as const)
        : undefined;

    res.json({
      directions: withPreviewHtml(directions, guide),
      styleGuideId: guide.meta.id,
      ...(critiqueSkipped ? { critiqueSkipped } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

export default router;
