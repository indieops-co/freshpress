import { z } from 'zod';

export const SocialPlatformSchema = z.enum(['linkedin', 'x', 'instagram', 'facebook']);
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const SocialAccountSchema = z.object({
  id: z.string(),
  platform: SocialPlatformSchema,
  label: z.string(),
  profileUrl: z.string().optional(),
  included: z.boolean().default(true),
});
export type SocialAccount = z.infer<typeof SocialAccountSchema>;

export const SocialSiteConfigSchema = z.object({
  siteId: z.string(),
  accounts: z.array(SocialAccountSchema).default([]),
  autoGenerateOnPublish: z.boolean().default(true),
  defaultFullScreenCards: z.boolean().default(true),
  updatedAt: z.string(),
});
export type SocialSiteConfig = z.infer<typeof SocialSiteConfigSchema>;

export const SocialVariantImagesSchema = z.object({
  hero: z.object({ url: z.string(), mediaAssetId: z.string().optional() }).optional(),
  textCardLight: z.object({ url: z.string() }).optional(),
  textCardDark: z.object({ url: z.string() }).optional(),
});

export const SocialVariantSchema = z.object({
  id: z.string(),
  platform: SocialPlatformSchema,
  variantIndex: z.union([z.literal(1), z.literal(2)]),
  bodyText: z.string(),
  suggestedTags: z.array(z.string()).default([]),
  images: SocialVariantImagesSchema.default({}),
});
export type SocialVariant = z.infer<typeof SocialVariantSchema>;

export const SocialGenerationBatchSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  sourcePostId: z.string(),
  generationRun: z.number(),
  sourceSection: z.string(),
  targetKeywords: z.array(z.string()),
  status: z.enum(['pending_review', 'partially_accepted', 'completed', 'discarded']),
  variants: z.array(SocialVariantSchema),
  createdAt: z.string(),
});
export type SocialGenerationBatch = z.infer<typeof SocialGenerationBatchSchema>;

export const SocialPostDraftSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  sourcePostId: z.string(),
  batchId: z.string(),
  platform: SocialPlatformSchema,
  accountId: z.string(),
  bodyText: z.string(),
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published']),
  targetKeywords: z.array(z.string()),
  sourceSection: z.string(),
  generationRun: z.number(),
  images: z
    .object({
      hero: z.string().optional(),
      textCardLight: z.string().optional(),
      textCardDark: z.string().optional(),
    })
    .default({}),
  publishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SocialPostDraft = z.infer<typeof SocialPostDraftSchema>;

export const PLATFORM_LIMITS: Record<SocialPlatform, { maxChars: number; maxTags: number; warnAt?: number }> = {
  linkedin: { maxChars: 3000, maxTags: 5 },
  x: { maxChars: 280, maxTags: 2 },
  instagram: { maxChars: 2200, maxTags: 30 },
  facebook: { maxChars: 63206, maxTags: 10, warnAt: 500 },
};

export function slugifyTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

export function buildHashtagLine(tags: string[]): string {
  return tags
    .map((t) => slugifyTag(t))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(' ');
}

export function buildFullPostText(bodyText: string, tags: string[]): string {
  const hashtags = buildHashtagLine(tags);
  if (!hashtags) return bodyText.trim();
  return `${bodyText.trim()}\n\n${hashtags}`;
}

export interface AcceptVariantSelection {
  variantId: string;
  includeHero?: boolean;
  includeTextCardLight?: boolean;
  includeTextCardDark?: boolean;
}

export interface SocialGenerationMeta {
  runCount: number;
  usedSections: string[];
}
