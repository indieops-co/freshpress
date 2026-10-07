/**
 * Chunk 8 — divergent-direction orchestration (base decision #4: user-configurable
 * 1–3 directions). Each direction generates one home page from a scaffold, and
 * directions are made STRUCTURALLY distinct, not adjective-swapped:
 *
 *  - A pure `planDirections()` chooses, per direction, a scaffold variation
 *    (closest match → one dropped optional section → adjacent-industry scaffold)
 *    whose structural fingerprint (ordered section types) differs from every
 *    prior direction's. This is the fan-out's deterministic backbone.
 *  - `generateSiteDirections()` runs the AI SEQUENTIALLY (open-question #2:
 *    David chose sequential): each direction's prompt carries the prior
 *    directions' fingerprints + opening lines as an explicit avoid-list, so copy
 *    diverges too, with real feedback rather than a pre-planned guess.
 *
 * Each generated page is run through `validateGeneratedPage()` so a malformed
 * direction is flagged, never silently returned as if sound.
 */
import type { PageContent } from '../content/types.js';
import type { IndustryScaffold } from '../design/section-patterns.js';
import { validateGeneratedPage } from '../guardian/validate-generated-page.js';
import type { AiCredentials } from './chat.js';
import type { DirectionCritique } from './critique-direction.js';
import {
  generatePageContent,
  selectIncludedSections,
  pageFingerprint,
  type GenerationContext,
} from './generate-page-content.js';

export interface DirectionPlan {
  scaffold: IndustryScaffold;
  /** Optional section ids dropped for this direction (structural variation). */
  dropSectionIds: string[];
  /** Human-readable angle for this direction, fed to the prompt + shown in the picker. */
  directive: string;
  /** Ordered section types after drops — the distinctness key. */
  fingerprint: string[];
}

/** Fingerprint of a scaffold with a given optional-section drop set (pure). */
function fingerprintFor(scaffold: IndustryScaffold, dropSectionIds: string[], includeOptIn: boolean): string[] {
  // Reuse the same inclusion logic the builder uses, so a plan's fingerprint
  // matches the page it will actually produce (no drift).
  const included = selectIncludedSections(
    scaffold,
    { sections: scaffold.sections.map((s) => ({ id: s.id, include: true, fields: {}, items: [] })) },
    dropSectionIds,
    includeOptIn
  );
  return pageFingerprint(included);
}

/**
 * Plan up to `count` structurally-distinct directions. Candidate order:
 *   1. base scaffold, full            → "the most complete layout"
 *   2. base scaffold, one optional dropped (each optional, in order)
 *   3. each adjacent scaffold, full   → "a structure closer to a <name> site"
 * Greedily takes candidates whose fingerprint hasn't been used yet. Pure —
 * unit-tested directly. Always returns at least one plan (the base, full).
 * Opt-in sections (signup) are in every direction or none (`includeOptIn`) —
 * never dropped as a variation, so they can't crowd out a real alternative.
 */
export function planDirections(
  base: IndustryScaffold,
  adjacents: IndustryScaffold[],
  count: number,
  includeOptIn = false
): DirectionPlan[] {
  // Coerce to an integer in [1,3]; a non-finite/zero count falls back to 1 (Math.min(3, NaN) is NaN).
  const target = Math.max(1, Math.min(3, Math.floor(count) || 1));
  const optionalIds = base.sections.filter((s) => s.optional && !s.optIn).map((s) => s.id);

  const candidates: DirectionPlan[] = [];
  const add = (scaffold: IndustryScaffold, dropSectionIds: string[], directive: string) => {
    candidates.push({ scaffold, dropSectionIds, directive, fingerprint: fingerprintFor(scaffold, dropSectionIds, includeOptIn) });
  };

  add(base, [], 'the most complete layout for this business');
  for (const id of optionalIds) {
    const label = base.sections.find((s) => s.id === id)?.label ?? id;
    add(base, [id], `a leaner layout that drops the "${label}" section`);
  }
  for (const adj of adjacents) {
    add(adj, [], `a structure closer to a ${adj.name.toLowerCase()} site`);
  }

  const chosen: DirectionPlan[] = [];
  const used = new Set<string>();
  for (const cand of candidates) {
    if (chosen.length >= target) break;
    const key = cand.fingerprint.join('>');
    if (used.has(key)) continue;
    used.add(key);
    chosen.push(cand);
  }

  // If distinct candidates ran out (very small scaffold), pad with the base so
  // the caller always gets the requested count — accepting a repeat rather than
  // silently returning fewer.
  while (chosen.length < target) {
    chosen.push({ scaffold: base, dropSectionIds: [], directive: 'the most complete layout for this business', fingerprint: fingerprintFor(base, [], includeOptIn) });
  }

  return chosen;
}

export interface GeneratedDirection {
  index: number;
  scaffoldId: string;
  scaffoldName: string;
  directive: string;
  fingerprint: string[];
  /** validateGeneratedPage verdict for this direction's page. */
  valid: boolean;
  errors: string[];
  page: { path: string; title: string; content: PageContent };
  /**
   * Full themed HTML for the picker's live iframe preview (Phase 7, decision
   * #5). Populated by the /generate endpoint (withPreviewHtml), not here — the
   * renderer needs the site's StyleGuide, which this orchestrator deliberately
   * doesn't hold.
   */
  previewHtml?: string;
  /**
   * Design Powerpack critique (critique-direction.ts) — present only when the
   * workspace has the designPowerpack feature AND the /generate request opted
   * in with `critique: true`. Additive/optional: the response shape without it
   * is unchanged. Phase 7's direction picker displays it.
   */
  critique?: DirectionCritique;
}

export interface SiteDirectionsInput {
  /** Ranked scaffolds (rankScaffolds output): [0] is the base, the rest are adjacents. */
  scaffolds: IndustryScaffold[];
  ctx: GenerationContext;
  count: number;
  credentials: AiCredentials;
  pageNumber?: number;
  /** Add opt-in sections (the newsletter signup) to every direction — decided by site-generation.ts's plan gate. */
  includeOptIn?: boolean;
}

/** The direction's opening h1 copy, or null when its scaffold has no h1 section. */
export function headlineOf(content: PageContent): string | null {
  const headlineSlot = Object.values(content.slots).find((s) => s.tag === 'h1');
  return headlineSlot?.value?.trim() || null;
}

/** Case/whitespace-insensitive form for duplicate comparison. */
export function normalizeHeadline(headline: string): string {
  return headline.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Should this direction be re-rolled because its headline duplicates an
 * earlier direction's? A page with no h1 never re-rolls, and the caller makes
 * at most ONE re-roll per direction — when the AI is down every direction
 * falls back to the same placeholder headline, and looping would never converge.
 */
export function shouldReroll(newHeadline: string | null, priorOpeners: string[]): boolean {
  if (!newHeadline || priorOpeners.length === 0) return false;
  const normalized = normalizeHeadline(newHeadline);
  return priorOpeners.some((o) => normalizeHeadline(o) === normalized);
}

/** The hard prompt constraint carrying every already-used opener (soft "angle" text alone proved ignorable). */
function forbiddenHeadlinesLine(priorOpeners: string[]): string {
  if (priorOpeners.length === 0) return '';
  const list = priorOpeners.map((o) => `"${o}"`).join(' ; ');
  return ` FORBIDDEN opening headlines (already used by other versions): ${list}. Write a completely different opening headline.`;
}

/** Short summary of a produced direction, fed to the next direction's prompt as an avoid-list entry. */
function summarize(fingerprint: string[], content: PageContent): string {
  const opener = headlineOf(content);
  return `${opener ? `opens "${opener}", ` : ''}structure ${fingerprint.join(' → ')}`;
}

/**
 * Generate `count` divergent directions SEQUENTIALLY, threading each produced
 * direction's fingerprint + opener into the next one's prompt as an avoid-list.
 */
export async function generateSiteDirections(input: SiteDirectionsInput): Promise<GeneratedDirection[]> {
  const { scaffolds, ctx, count, credentials, pageNumber = 1, includeOptIn = false } = input;
  const base = scaffolds[0];
  if (!base) throw new Error('generateSiteDirections requires at least one scaffold');
  const adjacents = scaffolds.slice(1);

  const plans = planDirections(base, adjacents, count, includeOptIn);
  const brandName = ctx.brandName;
  const directions: GeneratedDirection[] = [];
  const priorSummaries: string[] = [];
  const priorOpeners: string[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const avoid = priorSummaries.length
      ? ` Make this version clearly different from the previous one(s): ${priorSummaries.join(' ; ')}.${forbiddenHeadlinesLine(priorOpeners)}`
      : '';
    let content = await generatePageContent(
      plan.scaffold,
      { ...ctx, variationDirective: plan.directive + avoid },
      credentials,
      { pageNumber, dropSectionIds: plan.dropSectionIds, includeOptIn }
    );

    // One bounded re-roll when the headline still duplicates an earlier
    // direction's — the duplicated copy joins the FORBIDDEN list so the retry
    // has the concrete string to steer away from. Whatever comes back is kept.
    const opener = headlineOf(content);
    if (opener && shouldReroll(opener, priorOpeners)) {
      content = await generatePageContent(
        plan.scaffold,
        { ...ctx, variationDirective: plan.directive + avoid + forbiddenHeadlinesLine([...priorOpeners, opener]) },
        credentials,
        { pageNumber, dropSectionIds: plan.dropSectionIds, includeOptIn }
      );
    }

    const validation = validateGeneratedPage(content);
    // The fingerprint the page ACTUALLY produced (page-root child section types) — the source of
    // truth reported to the picker and threaded into the avoid-list. With deterministic structure
    // this equals plan.fingerprint, but reading it from the built page can never drift.
    const fingerprint = content.containers?.[0]?.children.map((c) => c.suggestedType ?? '') ?? plan.fingerprint;
    priorSummaries.push(summarize(fingerprint, content));
    const finalOpener = headlineOf(content);
    if (finalOpener) priorOpeners.push(finalOpener);

    directions.push({
      index: i,
      scaffoldId: plan.scaffold.id,
      scaffoldName: plan.scaffold.name,
      directive: plan.directive,
      fingerprint,
      valid: validation.ok,
      errors: validation.errors,
      page: { path: '/', title: `${brandName} — Home`, content },
    });
  }

  return directions;
}
