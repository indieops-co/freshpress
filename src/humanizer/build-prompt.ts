import type { HumanizerContentType, HumanizerSiteConfig } from './types.js';
import { loadAugmentSkill, loadUpstreamSkill } from './loader.js';

export const SIMPLE_HUMANIZE_PROMPT = `Rewrite the HTML content to sound more human and natural. Vary sentence length, use conversational tone, avoid AI patterns. Return ONLY the rewritten HTML body — no markdown fences, no explanation.`;

export interface BuildPromptInput {
  config: HumanizerSiteConfig;
  contentType: HumanizerContentType;
  includeReview: boolean;
  styleGuideAddition?: string;
}

export function substitutePlaceholders(
  template: string,
  config: HumanizerSiteConfig,
  contentType: HumanizerContentType
): string {
  const voiceBlock = config.voiceSample?.trim()
    ? `\n## Author voice sample\nMatch this writing style:\n\n${config.voiceSample.trim()}\n`
    : '';

  return template
    .replace(/\{\{TONE\}\}/g, config.tone)
    .replace(/\{\{READING_LEVEL\}\}/g, config.readingLevel)
    .replace(/\{\{VOICE_SAMPLE_BLOCK\}\}/g, voiceBlock)
    .replace(/\{\{CONTENT_TYPE\}\}/g, contentType)
    .replace(
      /\{\{CUSTOM_AUGMENT\}\}/g,
      config.customAugment?.trim() ? `\n## Site-specific rules\n\n${config.customAugment.trim()}\n` : ''
    );
}

export async function buildHumanizerPrompt(input: BuildPromptInput): Promise<string> {
  const [upstream, augment] = await Promise.all([loadUpstreamSkill(), loadAugmentSkill()]);
  const merged = `${upstream}\n\n---\n\n${substitutePlaceholders(augment, input.config, input.contentType)}`;

  const reviewNote = input.includeReview
    ? 'Set includeReview to true in the user message — return full JSON with review object.'
    : 'Set includeReview to false — return JSON with humanizedHtml only.';

  const styleNote = input.styleGuideAddition?.trim()
    ? `\n\n## Site style context\n${input.styleGuideAddition.trim()}`
    : '';

  return `${merged}${styleNote}\n\n## Runtime\n${reviewNote}`;
}

export function buildUserMessage(html: string, includeReview: boolean): string {
  return JSON.stringify({ includeReview, html });
}
