/**
 * Chunk E — the enrichment seam. Distills a site's approved Deep Brand Research
 * (+ its brand-voice writing skill) into one token-bounded block that generation
 * prompts (social posts, page copy) append verbatim. ONLY approved docs contribute:
 * unapproved or unreviewed research must never steer published content.
 */
import type { BrandResearch } from './brand-research-types.js';
import type { WritingSkill } from '../humanizer/types.js';

export const BRAND_CONTEXT_MAX_CHARS = 2200;

function clip(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  // Leave room for the ellipsis so the result never exceeds maxChars.
  let sliced = trimmed.slice(0, maxChars - 1);
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) sliced = sliced.slice(0, -1);
  return `${sliced}…`;
}

/**
 * Build the injection block, or undefined when the site has nothing approved to say.
 * Priority order under the cap: voice summary → never-say → beliefs → golden quotes →
 * a voice sample. Later items are dropped whole if they would overflow; never-say sits
 * early because a compact hard constraint must survive verbose upstream prose.
 */
export function buildBrandVoiceContext(opts: {
  brandResearch?: BrandResearch | null;
  brandVoiceSkill?: WritingSkill | null;
}): string | undefined {
  const { brandResearch, brandVoiceSkill } = opts;
  const docs = brandResearch?.enabled ? brandResearch.docs : undefined;
  const sections: string[] = [];

  const voiceSummary = docs?.voiceSummary;
  if (voiceSummary?.approved && voiceSummary.summary.trim()) {
    sections.push(`Brand voice & strategy (follow strictly):\n${voiceSummary.summary.trim()}`);
  }

  if (brandVoiceSkill?.neverPhrases?.length) {
    sections.push(`Never say: ${brandVoiceSkill.neverPhrases.join('; ')}`);
  }

  const beliefs = docs?.beliefs;
  if (beliefs?.approved && beliefs.beliefs.length > 0) {
    sections.push(
      `Beliefs every piece of content should quietly reinforce (never as slogans):\n${beliefs.beliefs
        .map((b) => `- ${b.statement}`)
        .join('\n')}`
    );
  }

  const interviews = docs?.interviews;
  if (interviews?.approved) {
    const quotes = interviews.customers
      .map((c) => c.answers.customerQuote.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (quotes.length > 0) {
      sections.push(`Real-customer phrasing to echo:\n${quotes.map((q) => `- "${clip(q, 200)}"`).join('\n')}`);
    }
  }

  const sample = brandVoiceSkill?.samples?.[0]?.text?.trim();
  if (sample) {
    sections.push(`Writing sample of the brand's voice:\n${clip(sample, 500)}`);
  }

  if (sections.length === 0) return undefined;

  // Drop whole trailing sections rather than cutting one mid-sentence.
  const included: string[] = [];
  let length = 0;
  for (const section of sections) {
    if (length + section.length + 2 > BRAND_CONTEXT_MAX_CHARS) break;
    included.push(section);
    length += section.length + 2;
  }
  if (included.length === 0) included.push(clip(sections[0], BRAND_CONTEXT_MAX_CHARS));
  return included.join('\n\n');
}
