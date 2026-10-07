import { callAi, stripCodeFences } from './ai-call.js';
import type { HumanizerSiteConfig } from './types.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turns AI plain-text paragraphs into the `<p>` HTML the compose/reply editor expects. */
export function toParagraphHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '<p></p>';
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * Builds the generation system prompt from the site's evolvable email-reply skill —
 * falls back to the general voiceSample when no email-specific samples exist yet.
 */
export function buildDraftReplySystemPrompt(config: HumanizerSiteConfig): string {
  const skill = config.emailReplySkill;
  const samples = skill?.samples?.length ? skill.samples.map((s) => s.text) : config.voiceSample ? [config.voiceSample] : [];

  const sampleBlock = samples.length
    ? `\n## Writing samples to match (match this voice, not necessarily this content)\n${samples
        .map((s, i) => `Sample ${i + 1}:\n${s}`)
        .join('\n\n')}\n`
    : '';

  const neverBlock = skill?.neverPhrases?.length
    ? `\n## Never say or do\n${skill.neverPhrases.map((p) => `- ${p}`).join('\n')}\n`
    : '';

  const customBlock = config.customAugment?.trim() ? `\n## Additional rules\n${config.customAugment.trim()}\n` : '';

  return `You are drafting a reply to an inbound email on behalf of this business, in its own authentic voice.
Tone: ${config.tone}
Reading level: ${config.readingLevel}
${sampleBlock}${neverBlock}${customBlock}
Write ONLY the reply body as plain-text paragraphs, separated by a blank line between paragraphs.
No subject line. No greeting/sign-off boilerplate unless it reads naturally. No signature block — that is added separately.
Do not invent facts, prices, or commitments that aren't implied by the inbound email. Keep it concise.
Return only the reply text — no markdown fences, no explanation.`;
}

export interface DraftEmailReplyInput {
  inboundSubject: string;
  inboundBodyText: string;
  config: HumanizerSiteConfig;
}

/** Generates a first-draft reply body from scratch (not a rewrite like humanizeHtml) in the site's brand voice. */
export async function draftEmailReply(input: DraftEmailReplyInput): Promise<{ draftHtml: string }> {
  const system = buildDraftReplySystemPrompt(input.config);
  const user = `Subject: ${input.inboundSubject}\n\n${input.inboundBodyText}`;
  const raw = await callAi(system, user, 1024);
  return { draftHtml: toParagraphHtml(stripCodeFences(raw)) };
}
