import { nanoid } from 'nanoid';
import type { BlogPost } from '../content/silo-types.js';
import type { SocialAccount, SocialGenerationBatch, SocialPlatform, SocialVariant } from '../content/social-types.js';
import { PLATFORM_LIMITS } from '../content/social-types.js';
import { buildBrandVoiceContext } from '../content/brand-voice-context.js';
import { composeStyleContext } from '../design/design-excellence.js';
import { callAiJson, extractJsonValue } from '../ai/call-json.js';
import { resolveAiKeys } from '../integrations/resolve.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { getBrandResearchStore } from '../storage/brand-research.js';
import { getHumanizerConfigStore } from '../storage/humanizer-config.js';
import { getStorage } from '../storage/filesystem.js';
import { generateTextCardsForSite } from './text-card.js';
import {
  buildGenerationMetaUpdate,
  extractBlogSections,
  extractHeroImageUrl,
  pickNextSection,
} from './sections.js';

const PLATFORM_RULES: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn: max 3000 chars, 3-5 hashtags, short paragraphs, hook first line',
  x: 'X/Twitter: max 280 chars, 1-2 hashtags, punchy single post',
  instagram: 'Instagram: max 2200 chars, 5-10 hashtags suggested, emoji sparingly, CTA last line',
  facebook: 'Facebook: conversational tone, optional hashtags, warn if over 500 chars',
};

export interface GenerateOptions {
  siteId: string;
  post: BlogPost;
  accounts: SocialAccount[];
  includeFullScreenCards?: boolean;
  siteDomain?: string;
}

export interface GenerateResult {
  batch: Omit<SocialGenerationBatch, 'id' | 'createdAt' | 'status'>;
  updatedMeta: BlogPost['socialGenerationMeta'];
  overlapWarning?: { run: number };
}

export interface SocialBatchPromptInput {
  post: Pick<BlogPost, 'title' | 'keyword'>;
  section: { heading: string; excerpt: string };
  outline: string;
  usedList: string;
  generationRun: number;
  platforms: SocialPlatform[];
  brandContext?: string;
  /**
   * composeStyleContext(guide) when the site has a StyleGuide — carries the
   * brand's designRules (capped at 2000 chars by formatDesignRulesBlock) into
   * the caption prompt. Platform length rules constrain the OUTPUT captions
   * (enforced post-parse via PLATFORM_LIMITS), so the added prompt context
   * never collides with a platform budget.
   */
  styleContext?: string;
}

export function buildSocialBatchPrompt(input: SocialBatchPromptInput): string {
  const { post, section, outline, usedList, generationRun, platforms, brandContext, styleContext } = input;
  return `Generate social media post variants for a blog article.
${brandContext ? `\n${brandContext}\n` : ''}${styleContext ? `\nBrand style context:\n${styleContext}\n` : ''}
Blog title: ${post.title}
Pillar keyword: ${post.keyword}
Target section for this run: "${section.heading}" — ${section.excerpt}
Blog outline:
${outline}

Previously used sections: ${usedList}
Generation run #${generationRun}

Platforms needed: ${platforms.join(', ')}

For EACH platform, create exactly 2 distinct variants (variantIndex 1 and 2).
Return JSON only:
{
  "variants": [
    {
      "platform": "linkedin|x|instagram|facebook",
      "variantIndex": 1,
      "bodyText": "plain text caption without hashtags",
      "suggestedTags": ["tag1", "tag2"]
    }
  ]
}

Rules per platform:
${platforms.map((p) => PLATFORM_RULES[p]).join('\n')}

Do NOT include hashtags in bodyText. Keep within character limits.`;
}


export async function generateSocialBatch(opts: GenerateOptions): Promise<GenerateResult> {
  const { siteId, post, accounts } = opts;
  const included = accounts.filter((a) => a.included);
  if (included.length === 0) {
    throw new Error('No included social accounts configured');
  }

  const sections = extractBlogSections(post.bodyHtml);
  const { section, overlap, overlapRun } = pickNextSection(sections, post.socialGenerationMeta);
  const generationRun = (post.socialGenerationMeta?.runCount ?? 0) + 1;
  const targetKeywords = [post.keyword, section.heading].filter(Boolean);

  const outline = sections
    .map((s) => `- ${s.heading}: ${s.excerpt.slice(0, 120)}`)
    .join('\n');

  const usedList = (post.socialGenerationMeta?.usedSections ?? []).join(', ') || 'none';
  const platforms = included.map((a) => a.platform);

  // Approved Deep Brand Research + the site's brand-voice skill + the StyleGuide's
  // design rules sharpen every variant. Best-effort and per-source isolated: a corrupt
  // research file must not also drop the (independent) voice skill's never-say
  // guardrails or the style context, and none of them may block the batch.
  const [researchResult, humanizerResult, styleGuideResult] = await Promise.allSettled([
    getBrandResearchStore().then((s) => s.get(siteId)),
    getHumanizerConfigStore().then((s) => s.getOrCreateSiteConfig(siteId)),
    getStyleGuideStore().then((s) => s.get(siteId)),
  ]);
  const brandContext = buildBrandVoiceContext({
    brandResearch: researchResult.status === 'fulfilled' ? researchResult.value : undefined,
    brandVoiceSkill: humanizerResult.status === 'fulfilled' ? humanizerResult.value?.brandVoiceSkill : undefined,
  });
  // Swallowed on purpose (prompt context is best-effort), but a failed load also
  // means the text cards below render unbranded — leave a trace for the operator.
  if (styleGuideResult.status === 'rejected') {
    console.warn(`[social] StyleGuide load failed for ${siteId}; captions and text cards proceed unbranded:`, styleGuideResult.reason);
  }
  const styleGuide = styleGuideResult.status === 'fulfilled' ? styleGuideResult.value : undefined;

  const prompt = buildSocialBatchPrompt({
    post,
    section,
    outline,
    usedList,
    generationRun,
    platforms,
    brandContext,
    styleContext: styleGuide ? composeStyleContext(styleGuide) : undefined,
  });

  const ai = await resolveAiKeys();
  if (!ai) throw new Error('Configure AI keys in Admin → Integrations first');
  // callAiJson handles both providers, finds the text block instead of
  // assuming content[0] (newer Anthropic models can lead with non-text
  // blocks), and throws on truncation.
  const raw = await callAiJson(
    'You write social media post variants. Respond with ONLY the requested JSON.',
    prompt,
    ai,
    { maxTokens: 4096 }
  );
  // Unparseable/empty output degrades to the fallback variants below (title +
  // excerpt per platform) instead of failing the batch — publish-triggered
  // auto-generation must never lose its run to one bad completion.
  const value = extractJsonValue(raw, 'object');
  if (!value) {
    console.warn(`[social] AI variants unparseable for ${siteId}; using fallback variants`);
  }

  const parsed = (value ?? {}) as {
    variants?: Array<{
      platform: SocialPlatform;
      variantIndex: 1 | 2;
      bodyText: string;
      suggestedTags: string[];
    }>;
  };

  const heroUrl = extractHeroImageUrl(post.bodyHtml);
  let textCards: { textCardLight?: string; textCardDark?: string } = {};

  if (opts.includeFullScreenCards !== false) {
    const storage = await getStorage();
    const publicDir = storage.getSitePublicDir(siteId);
    textCards = await generateTextCardsForSite(
      siteId,
      publicDir,
      section.heading.slice(0, 120) || post.title.slice(0, 120),
      post.keyword,
      styleGuide
    );
  }

  const variants: SocialVariant[] = [];
  for (const row of parsed.variants ?? []) {
    if (!platforms.includes(row.platform)) continue;
    const limits = PLATFORM_LIMITS[row.platform];
    let bodyText = row.bodyText.trim();
    if (bodyText.length > limits.maxChars) {
      bodyText = bodyText.slice(0, limits.maxChars - 3) + '...';
    }

    variants.push({
      id: nanoid(10),
      platform: row.platform,
      variantIndex: row.variantIndex === 2 ? 2 : 1,
      bodyText,
      suggestedTags: (row.suggestedTags ?? []).slice(0, limits.maxTags),
      images: {
        ...(heroUrl ? { hero: { url: heroUrl } } : {}),
        ...(textCards.textCardLight ? { textCardLight: { url: textCards.textCardLight } } : {}),
        ...(textCards.textCardDark ? { textCardDark: { url: textCards.textCardDark } } : {}),
      },
    });
  }

  // Ensure 2 variants per included platform
  for (const account of included) {
    const existing = variants.filter((v) => v.platform === account.platform);
    while (existing.length < 2) {
      const idx = (existing.length + 1) as 1 | 2;
      const fallback: SocialVariant = {
        id: nanoid(10),
        platform: account.platform,
        variantIndex: idx,
        bodyText: `${post.title}\n\n${section.excerpt}`.slice(0, PLATFORM_LIMITS[account.platform].maxChars),
        suggestedTags: [post.keyword.replace(/\s+/g, '')].filter(Boolean),
        images: variants[0]?.images ?? {},
      };
      variants.push(fallback);
      existing.push(fallback);
    }
  }

  const batch: Omit<SocialGenerationBatch, 'id' | 'createdAt' | 'status'> = {
    siteId,
    sourcePostId: post.id,
    generationRun,
    sourceSection: section.slug,
    targetKeywords,
    variants,
  };

  return {
    batch,
    updatedMeta: buildGenerationMetaUpdate(post, section.slug),
    overlapWarning: overlap && overlapRun ? { run: overlapRun } : undefined,
  };
}
