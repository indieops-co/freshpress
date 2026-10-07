/**
 * Chunk 7 — Industry section-pattern library.
 *
 * A curated, hand-authored seed of full-page structural scaffolds per industry.
 * The Chunk 8 generator picks a scaffold via `selectScaffold()` and turns its
 * ordered `sections` into an authoritatively-tagged `PageContent`. This is the
 * default "pattern knowledge" (base decision #7) — zero runtime fetch; the
 * optional competitor-research path (Chunk 12) layers extra patterns on top.
 *
 * Load pattern mirrors `awesome-design-md.ts`/`themes-manifest.json`: a
 * compile-time JSON import (surfaced by `listScaffolds()`) plus a
 * `process.cwd()`-relative runtime read (`loadBundledScaffolds()`) that falls
 * back to the bundled import on error. The manifest JSON is copied to `dist/`
 * at build, same as `themes-manifest.json`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import scaffoldsManifest from './section-patterns-manifest.json' with { type: 'json' };
import { CORE_ELEMENT_TYPES } from '../content/named-elements.js';

/**
 * One reusable structural section (a hero, a feature grid, a pricing table…).
 * `type` is a NamedElement core taxonomy type (Chunk 2) so the generator can
 * stamp the emitted container's `suggestedType` directly. `slotHints` name the
 * content slots the section typically carries — advisory input to the
 * generator, not a hard contract.
 */
export const SectionPatternSchema = z.object({
  id: z.string(),
  /** NamedElement core type this section maps to (HeroSection, FeatureGrid, …). */
  type: z.enum(CORE_ELEMENT_TYPES),
  label: z.string(),
  /** What the section accomplishes / when to use it — fed to the generator prompt. */
  intent: z.string(),
  /** Advisory content slots this section usually needs, e.g. ["headline","subhead","primaryCta"]. */
  slotHints: z.array(z.string()).default([]),
  /** A minimal page may drop optional sections (Chunk 8 fan-out "one substituted/removed section"). */
  optional: z.boolean().default(false),
  /**
   * Opt-in section (the newsletter signup): left out of every direction unless the
   * generate request opts in (`includeSignup`, plan-gated in site-generation.ts).
   * Never a fan-out variation axis.
   */
  optIn: z.boolean().default(false),
});
export type SectionPattern = z.infer<typeof SectionPatternSchema>;

/**
 * A full-page structural scaffold for one industry: an ordered list of section
 * patterns plus the signals `selectScaffold()` matches against. The ordered
 * list of section `type`s is the "structural fingerprint" the Chunk 8 fan-out
 * uses as an avoid-list across divergent directions.
 */
export const IndustryScaffoldSchema = z.object({
  id: z.string(),
  /** Canonical industry label ("SaaS / software", "Restaurant / local"). */
  industry: z.string(),
  /** Lowercase keywords `selectScaffold` matches a free-text industry against. */
  aliases: z.array(z.string()).default([]),
  name: z.string(),
  desc: z.string(),
  /** Personality traits (Chunk 9's pills) this scaffold suits — soft tie-breaker. */
  personalityAffinity: z.array(z.string()).default([]),
  /** Mood keywords this scaffold suits — soft tie-breaker. */
  moodAffinity: z.array(z.string()).default([]),
  /** Ordered page sections. First is typically Nav/Header, last typically Footer. */
  sections: z.array(SectionPatternSchema).min(1),
});
export type IndustryScaffold = z.infer<typeof IndustryScaffoldSchema>;

export const SectionPatternsManifestSchema = z.array(IndustryScaffoldSchema);

/** The `id` of the always-present catch-all scaffold — never fail open into "no structure". */
export const GENERIC_SCAFFOLD_ID = 'generic';

let cached: IndustryScaffold[] | null = null;

/** Bundled scaffolds from the compile-time JSON import (validated once, cached). */
export function listScaffolds(): IndustryScaffold[] {
  if (!cached) cached = SectionPatternsManifestSchema.parse(scaffoldsManifest);
  return cached;
}

/**
 * Runtime-read scaffolds from `src/design/section-patterns-manifest.json`
 * (`process.cwd()`-relative), falling back to the bundled import on any error —
 * exact mirror of `loadBundledManifest()` in `awesome-design-md.ts`.
 */
export async function loadBundledScaffolds(): Promise<IndustryScaffold[]> {
  const path = join(process.cwd(), 'src', 'design', 'section-patterns-manifest.json');
  try {
    const raw = await readFile(path, 'utf-8');
    return SectionPatternsManifestSchema.parse(JSON.parse(raw));
  } catch {
    return listScaffolds();
  }
}

/** The ordered list of section types — a scaffold's "structural fingerprint" (Chunk 8 avoid-list). */
export function structuralFingerprint(scaffold: Pick<IndustryScaffold, 'sections'>): string[] {
  return scaffold.sections.map((s) => s.type);
}

export type ScaffoldMatchType = 'exact' | 'partial' | 'affinity' | 'generic';

/** How strongly the industry signal matched: an exact string, a fuzzy phrase/word, or not at all. */
export type IndustryMatch = 'exact' | 'partial' | null;

export interface ScaffoldSelection {
  scaffold: IndustryScaffold;
  /** How the choice was made: a real industry hit, an affinity tie-break, or the generic fallback. */
  matchType: ScaffoldMatchType;
  /** The winning score (0 for a pure generic fallback). */
  score: number;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Score one scaffold against the intake signals. Industry is the dominant
 * signal (exact/alias/substring match); personality and mood are soft
 * tie-breakers so two industry-neutral requests still diverge by feel.
 * Pure — no I/O — so it (and `selectScaffold`) unit-test directly.
 */
export function scoreScaffold(
  scaffold: IndustryScaffold,
  industry: string | undefined,
  personality: string[] = [],
  mood: string[] = []
): { score: number; industryMatch: IndustryMatch } {
  let score = 0;
  let industryMatch: IndustryMatch = null;

  const ind = industry ? norm(industry) : '';
  if (ind && scaffold.id !== GENERIC_SCAFFOLD_ID) {
    // Candidates the free-text industry is matched against. Whole-word / phrase
    // matching only — a raw substring test would let a 3-letter alias ("app",
    // "bar", "shop") spuriously match arbitrary prose.
    const candidates = [norm(scaffold.industry), scaffold.id, ...scaffold.aliases.map(norm)];
    const indWords = new Set(ind.split(/[^a-z0-9]+/).filter(Boolean));

    if (candidates.includes(ind)) {
      score += 100; // exact industry / alias / id match
      industryMatch = 'exact';
    } else if (
      // A multi-word candidate phrase appears verbatim in the input ("online store", "coffee shop"),
      // or the input is a specific-enough substring of a candidate ("saas" ⊂ "saas / software").
      // Multi-word phrases outrank single-word hits (60 > 40), disambiguating "coffee shop" toward
      // the scaffold that lists the whole phrase rather than one generic word.
      candidates.some((c) => (c.includes(' ') && ind.includes(c)) || (ind.length >= 4 && c.includes(ind)))
    ) {
      score += 60;
      industryMatch = 'partial';
    } else if (candidates.some((c) => !c.includes(' ') && indWords.has(c))) {
      // A single-word candidate appears as a whole word in the input ("we run a coffee cafe" → "cafe").
      score += 40;
      industryMatch = 'partial';
    }
  }

  const personalitySet = new Set(personality.map(norm));
  score += scaffold.personalityAffinity.filter((p) => personalitySet.has(norm(p))).length * 5;

  const moodSet = new Set(mood.map(norm));
  score += scaffold.moodAffinity.filter((m) => moodSet.has(norm(m))).length * 5;

  return { score, industryMatch };
}

/**
 * Choose a scaffold from an explicit list — the pure core, so tests can drive
 * it with fixtures. Highest score wins; ties break toward the earlier scaffold
 * in the list (stable/deterministic). When nothing scores above zero, the
 * generic scaffold is returned so generation always has a structure to build
 * on ("never fails open into no structure", base plan).
 */
export function selectScaffoldFrom(
  scaffolds: IndustryScaffold[],
  industry?: string,
  personality: string[] = [],
  mood: string[] = []
): ScaffoldSelection {
  const generic =
    scaffolds.find((s) => s.id === GENERIC_SCAFFOLD_ID) ?? scaffolds[0];
  if (!generic) throw new Error('No scaffolds available — section-patterns manifest is empty');

  let best: ScaffoldSelection | null = null;
  for (const scaffold of scaffolds) {
    const { score, industryMatch } = scoreScaffold(scaffold, industry, personality, mood);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      const matchType: ScaffoldMatchType = industryMatch ?? 'affinity';
      best = { scaffold, matchType, score };
    }
  }

  return best ?? { scaffold: generic, matchType: 'generic', score: 0 };
}

/** Convenience over the bundled seed library — Chunk 8's entry point. */
export function selectScaffold(
  industry?: string,
  personality: string[] = [],
  mood: string[] = []
): ScaffoldSelection {
  return selectScaffoldFrom(listScaffolds(), industry, personality, mood);
}

/**
 * Rank scaffolds best-first for the given intake — the best match plus its
 * nearest "adjacent" scaffolds, used by Chunk 8's fan-out to blend an
 * adjacent-industry structure into a divergent direction. The generic scaffold
 * is always appended last as a guaranteed fallback. Deterministic (stable ties
 * by manifest order).
 */
export function rankScaffolds(
  industry?: string,
  personality: string[] = [],
  mood: string[] = []
): IndustryScaffold[] {
  const scaffolds = listScaffolds();
  const scored = scaffolds
    .map((scaffold, i) => ({ scaffold, i, score: scoreScaffold(scaffold, industry, personality, mood).score }))
    .filter((s) => s.scaffold.id !== GENERIC_SCAFFOLD_ID);
  // Highest score first; stable by manifest order on ties.
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const ranked = scored.map((s) => s.scaffold);
  const generic = scaffolds.find((s) => s.id === GENERIC_SCAFFOLD_ID);
  if (generic) ranked.push(generic);
  return ranked;
}
