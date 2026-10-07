import { z } from 'zod';

export const HumanizerModeSchema = z.enum(['simple', 'skill']);
export type HumanizerMode = z.infer<typeof HumanizerModeSchema>;

export const HumanizerContentTypeSchema = z.enum(['blog', 'email', 'social', 'auto']);
export type HumanizerContentType = z.infer<typeof HumanizerContentTypeSchema>;

export const WritingSampleSchema = z.object({
  id: z.string(),
  text: z.string(),
  addedAt: z.string(),
});
export type WritingSample = z.infer<typeof WritingSampleSchema>;

/**
 * Evolvable "skill" for a specific writing context — unlike the flat voiceSample below,
 * samples are added incrementally over time and paired with explicit negative constraints,
 * rather than replaced wholesale. Reused by multiple contexts (email replies, brand voice);
 * `WritingSkillEditor.tsx` renders one for each.
 */
export const WritingSkillSchema = z.object({
  samples: z.array(WritingSampleSchema).default([]),
  neverPhrases: z.array(z.string()).default([]),
});
export type WritingSkill = z.infer<typeof WritingSkillSchema>;

/** Email-reply writing skill — an alias of the shared shape (kept for the existing field name). */
export const EmailReplySkillSchema = WritingSkillSchema;
export type EmailReplySkill = WritingSkill;

export const HumanizerSiteConfigSchema = z.object({
  siteId: z.string(),
  mode: HumanizerModeSchema.default('simple'),
  tone: z.string().default('friendly-professional'),
  readingLevel: z.string().default("Bachelor's degree in liberal arts"),
  voiceSample: z.string().optional(),
  customAugment: z.string().optional(),
  contentTypeHint: HumanizerContentTypeSchema.default('auto'),
  /** Email-specific writing skill (auto-draft replies) — falls back to voiceSample if unset. */
  emailReplySkill: EmailReplySkillSchema.optional(),
  /** Brand voice & tone skill (Site Theme page, Chunk 6) — samples + never-say for site copy. */
  brandVoiceSkill: WritingSkillSchema.optional(),
  /** Whether opening a qualifying (non-promo) Inbox thread auto-generates a draft reply. */
  autoDraftEnabled: z.boolean().default(true),
  updatedAt: z.string(),
});

export type HumanizerSiteConfig = z.infer<typeof HumanizerSiteConfigSchema>;

export const HumanizerWorkspaceDefaultsSchema = z.object({
  defaultMode: HumanizerModeSchema.default('simple'),
  upstreamVersion: z.string().optional(),
  upstreamSyncedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type HumanizerWorkspaceDefaults = z.infer<typeof HumanizerWorkspaceDefaultsSchema>;

export interface HumanizerReviewScore {
  score: number;
  note: string;
}

export interface HumanizerReview {
  contentType: string;
  assessment: string;
  scores: Record<string, HumanizerReviewScore>;
  patternFlags: Array<{ quote: string; suggestion: string }>;
  topChanges: string[];
}

export interface HumanizeResult {
  humanizedHtml: string;
  mode: HumanizerMode;
  review?: HumanizerReview;
}

export interface HumanizeOptions {
  html: string;
  siteId: string;
  mode?: HumanizerMode;
  contentType?: HumanizerContentType;
  includeReview?: boolean;
}

export interface HumanizerManifest {
  repo: string;
  upstreamPath: string;
  version: string;
  syncedAt: string;
  changelog?: Array<{ date: string; note: string }>;
}
