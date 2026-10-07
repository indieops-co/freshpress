import { z } from 'zod';
import type { StyleGuide } from './style-guide.js';

/**
 * EmailFormat = visual tokens only (fonts, colors, spacing). No structure/layout —
 * that's EmailTemplate's job. A Template references a Format to render.
 */
export const EmailFormatColorsSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  background: z.string(), // outer page background, outside the Container
  surface: z.string(), // Container/card background
  text: z.string(),
  textMuted: z.string(),
  textInverse: z.string(),
  border: z.string(),
  linkColor: z.string(),
});

export const EmailFormatTypographySchema = z.object({
  headingFont: z.string(), // email-safe font stack, e.g. "Georgia, 'Times New Roman', serif"
  bodyFont: z.string(),
  headingWeight: z.string(),
  bodyWeight: z.string(),
  h1Size: z.string(),
  h2Size: z.string(),
  bodySize: z.string(),
  smallSize: z.string(),
  lineHeight: z.string(),
});

export const EmailFormatSpacingSchema = z.object({
  gutter: z.string(), // outer padding so content never touches the edge — maps to Container padding
  sectionGap: z.string(),
  paragraphGap: z.string(),
  buttonPaddingY: z.string(),
  buttonPaddingX: z.string(),
});

export const EmailFormatButtonSchema = z.object({
  background: z.string(),
  textColor: z.string(),
  radius: z.string(),
  fontWeight: z.string(),
});

export const EmailFormatProvenanceSchema = z.object({
  source: z.enum(['style-guide-sync', 'manual', 'imported']),
  sourceRef: z.string().optional(), // styleGuideId when source='style-guide-sync'; original format id when 'imported'
  sourceSiteId: z.string().optional(), // origin siteId for imports
  syncedAt: z.string().optional(), // timestamp of the (one-shot) derivation from a StyleGuide
  customized: z.boolean().default(false), // true once the user edits any field post-derivation
});

export const EmailFormatSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  isDefault: z.boolean().default(false),
  colors: EmailFormatColorsSchema,
  typography: EmailFormatTypographySchema,
  spacing: EmailFormatSpacingSchema,
  button: EmailFormatButtonSchema,
  provenance: EmailFormatProvenanceSchema,
  // Left in place for Phase 2+ (free library / marketplace) without a schema rewrite.
  visibility: z.enum(['private', 'workspace']).default('private'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EmailFormatColors = z.infer<typeof EmailFormatColorsSchema>;
export type EmailFormatTypography = z.infer<typeof EmailFormatTypographySchema>;
export type EmailFormatSpacing = z.infer<typeof EmailFormatSpacingSchema>;
export type EmailFormatButton = z.infer<typeof EmailFormatButtonSchema>;
export type EmailFormatProvenance = z.infer<typeof EmailFormatProvenanceSchema>;
export type EmailFormat = z.infer<typeof EmailFormatSchema>;

const EMAIL_SAFE_FALLBACK_SANS = 'Helvetica, Arial, sans-serif';
const EMAIL_SAFE_FALLBACK_SERIF = 'Georgia, "Times New Roman", serif';

function emailSafeFontStack(webFont: string): string {
  const looksSerif = /serif/i.test(webFont) && !/sans-serif/i.test(webFont);
  const fallback = looksSerif ? EMAIL_SAFE_FALLBACK_SERIF : EMAIL_SAFE_FALLBACK_SANS;
  return `${webFont}, ${fallback}`;
}

/**
 * Derives a new EmailFormat from a site's web StyleGuide. Only ever called to
 * CREATE a new EmailFormat row — never mutates an existing one. Web-only
 * concepts (radii, shadows, motion, component behavior beyond button/colors,
 * tailwindExtension) are deliberately dropped since they have no email-safe
 * meaning.
 */
export function deriveEmailFormatFromStyleGuide(
  guide: StyleGuide,
  siteId: string,
  opts?: { id?: string; name?: string }
): EmailFormat {
  const now = new Date().toISOString();
  const c = guide.colors;
  const scale = guide.typography.scale;
  return EmailFormatSchema.parse({
    id: opts?.id ?? `ef_${guide.meta.id}`,
    siteId,
    name: opts?.name ?? `${guide.meta.name} (site theme)`,
    isDefault: true,
    colors: {
      primary: c.primary,
      secondary: c.secondary,
      accent: c.accent,
      background: c.background,
      surface: c.surface,
      text: c.text,
      textMuted: c.textMuted,
      textInverse: c.textInverse,
      border: c.border,
      linkColor: c.accent,
    },
    typography: {
      headingFont: emailSafeFontStack(guide.typography.headingFont),
      bodyFont: emailSafeFontStack(guide.typography.bodyFont),
      headingWeight: scale.h1.weight,
      bodyWeight: scale.body.weight,
      h1Size: scale.h1.size,
      h2Size: scale.h2.size,
      bodySize: scale.body.size,
      smallSize: scale.bodySm.size,
      lineHeight: scale.body.lineHeight,
    },
    spacing: {
      gutter: guide.spacing.gutter,
      sectionGap: guide.spacing.lg,
      paragraphGap: guide.spacing.md,
      buttonPaddingY: guide.spacing.sm,
      buttonPaddingX: guide.spacing.lg,
    },
    button: {
      background: guide.components.button.primaryBg,
      textColor: guide.components.button.primaryText,
      radius: guide.components.button.primaryRadius,
      fontWeight: '600',
    },
    provenance: {
      source: 'style-guide-sync',
      sourceRef: guide.meta.id,
      syncedAt: now,
      customized: false,
    },
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  });
}

/** A plain, theme-agnostic starting point for "New Format" (blank/manual path). */
export function buildBlankEmailFormat(siteId: string, id: string, name = 'New Format'): EmailFormat {
  const now = new Date().toISOString();
  return EmailFormatSchema.parse({
    id,
    siteId,
    name,
    isDefault: false,
    colors: {
      primary: '#111111',
      secondary: '#666666',
      accent: '#111111',
      background: '#f5f5f5',
      surface: '#ffffff',
      text: '#111111',
      textMuted: '#666666',
      textInverse: '#ffffff',
      border: '#e5e5e5',
      linkColor: '#111111',
    },
    typography: {
      headingFont: emailSafeFontStack('Arial'),
      bodyFont: emailSafeFontStack('Arial'),
      headingWeight: '700',
      bodyWeight: '400',
      h1Size: '24px',
      h2Size: '20px',
      bodySize: '16px',
      smallSize: '13px',
      lineHeight: '1.5',
    },
    spacing: {
      gutter: '24px',
      sectionGap: '24px',
      paragraphGap: '16px',
      buttonPaddingY: '12px',
      buttonPaddingX: '24px',
    },
    button: {
      background: '#111111',
      textColor: '#ffffff',
      radius: '8px',
      fontWeight: '600',
    },
    provenance: { source: 'manual', customized: false },
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  });
}
