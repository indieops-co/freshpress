/**
 * Design-excellence prompt layer — distilled fundamentals injected into the
 * AI calls that shape a site's visual identity and copy. All wording is
 * original; the principles are distilled from four sources credited in
 * NOTICE.md: anthropics/skills `frontend-design` (Apache-2.0),
 * Trystan-SA/claude-design-system-prompt (MIT), bergside/typeui
 * fundamentals (MIT), and the VoltAgent/awesome-design-md corpus (MIT).
 *
 * Each consumer gets a purpose-built subset via the assembler functions
 * below — the DESIGN.md authoring call needs aesthetic direction; the
 * copywriter and content chat need only microcopy discipline plus the
 * brand's own rules. Constants are plain strings (no interpolation) so
 * they can never carry template-injection payloads into a prompt.
 */
import type { StyleGuide } from './style-guide.js';

/** Cap for the derived StyleGuide.designRules field (see parse-design-md.ts). */
export const DESIGN_RULES_MAX_CHARS = 2000;

export const ANTI_SLOP_BLOCKLIST = `AI-generated sites currently cluster around a few default looks. Never land on one of these unless the brand's own inputs point there explicitly:
- Warm cream background, high-contrast serif display face, terracotta or amber accent.
- Near-black background with a single bright acid-green or vermilion accent.
- Broadsheet-editorial: hairline rules, zero border-radius, dense newspaper columns.
Treat these three as occupied territory — the point of a custom design system is to be unmistakable for anyone else's site, including other AI-generated ones.`;

export const AESTHETIC_RISK = `Work like the design lead at a small studio whose clients pay for a point of view. Make deliberate, opinionated choices about palette, typography, and layout that are specific to THIS brand, and take one real aesthetic risk you can justify in a sentence. The hero is a thesis about the brand, not a template slot: it should say, visually, something only this brand would say.`;

export const PALETTE_DISCIPLINE = `Limit the palette to 3-5 colors total and commit to one temperature (warm, cool, or strictly neutral) — never mix temperatures. When inventing colors, build harmony by keeping perceived lightness and saturation consistent while varying hue (think oklch), rather than collecting unrelated swatches. Never solve a design problem by adding another accent color; reach for weight, spacing, or scale instead.`;

export const SIGNATURE_ELEMENT = `Name one signature visual element — a distinctive recurring device such as a border treatment, an unusual accent placement, a geometric motif, or a headline treatment — and describe it concretely enough that every component can carry it. This is what makes the design memorable.`;

export const CONFLICT_RESOLUTION = `Precedence when guidance conflicts: the brand's own stated inputs always win; the chosen design system wins for concrete values (colors, sizes, spacing, component specs); these fundamentals win for structural principles (hierarchy, rhythm, motion logic); accessibility is non-negotiable at every level and overrides everything above.`;

export const QUALITY_FLOOR = `Non-negotiable floor: layouts must read down to mobile widths, interactive elements need visible keyboard focus, motion must respect reduced-motion preferences, and text must keep readable contrast against its background.`;

export const MICROCOPY_RULES = `Write copy from the reader's side of the screen: name what the visitor gets, not what the system does. Prefer concrete nouns and numbers over marketing filler — never lean on "elevate", "unlock", "seamless", "empower", or "supercharge". Buttons say what happens ("Save changes", "Get the guide"), never "Submit". Every claim should be specific enough that a competitor could not paste it onto their own site.`;

/**
 * Full aesthetic-direction set for the DESIGN.md authoring prompt
 * (generate-design-md.ts) — the one call where the AI invents a visual
 * identity from scratch.
 */
export function designMdAuthoringExcellence(): string {
  return [
    'Design-excellence fundamentals (apply while authoring):',
    AESTHETIC_RISK,
    ANTI_SLOP_BLOCKLIST,
    PALETTE_DISCIPLINE,
    SIGNATURE_ELEMENT,
    CONFLICT_RESOLUTION,
    QUALITY_FLOOR,
  ].join('\n\n');
}

/**
 * Microcopy subset for copy-producing calls (page generation, content chat)
 * — those models pick no colors or layout, so they get writing discipline
 * only; aesthetic rules would be dead weight in their token budget.
 */
export function copyExcellence(): string {
  return MICROCOPY_RULES;
}

/** Cap text at a line boundary so a truncated rules list never ends mid-bullet. */
export function truncateAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf('\n', maxChars);
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, maxChars)).trimEnd();
}

/**
 * The one labeled, capped rules block every prompt uses — page generation and
 * chat must not carry their own copies of the label or the cap, or they drift.
 * Returns '' when there are no rules (callers skip the block entirely).
 */
export function formatDesignRulesBlock(designRules: string | undefined): string {
  const rules = designRules?.trim();
  if (!rules) return '';
  return `Design rules for this brand (follow the Do's, avoid the Don'ts):\n${truncateAtLineBoundary(rules, DESIGN_RULES_MAX_CHARS)}`;
}

/**
 * The style context string injected into content-chat prompts: the guide's
 * prompt addition plus, when present, the brand's own design rules carried
 * through from its source DESIGN.md (see extractDesignRules).
 */
export function composeStyleContext(
  guide: Pick<StyleGuide, 'aiSystemPromptAddition' | 'designRules'>
): string {
  const block = formatDesignRulesBlock(guide.designRules);
  if (!block) return guide.aiSystemPromptAddition;
  return `${guide.aiSystemPromptAddition}\n\n${block}`;
}
