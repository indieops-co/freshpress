import { z } from 'zod';

/**
 * EmailTemplate = structure/layout only (block arrangement). No visual tokens —
 * those come from whichever EmailFormat is applied at render time.
 */
export const EmailBlockKindSchema = z.enum([
  'header-logo',
  'heading',
  'body', // the rich-text (TipTap) authored HTML slot
  'cta-button',
  'divider',
  'signature-slot', // only rendered when "Include Signature" is on
  'footer',
]);
export type EmailBlockKind = z.infer<typeof EmailBlockKindSchema>;

export const EmailBlockSchema = z.object({
  id: z.string(),
  kind: EmailBlockKindSchema,
  required: z.boolean().default(false), // e.g. the body block can't be removed
  config: z.record(z.unknown()).default({}), // kind-specific, e.g. cta-button.label/href
});
export type EmailBlock = z.infer<typeof EmailBlockSchema>;

export const EmailTemplateSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  isDefault: z.boolean().default(false),
  blocks: z.array(EmailBlockSchema),
  maxWidth: z.string().default('600px'), // layout property — belongs here, not on Format
  visibility: z.enum(['private', 'workspace']).default('private'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

/** Starter template: logo header -> heading -> body -> CTA -> divider -> signature -> footer. */
export function buildDefaultEmailTemplate(siteId: string, id: string, name = 'Standard'): EmailTemplate {
  const now = new Date().toISOString();
  return EmailTemplateSchema.parse({
    id,
    siteId,
    name,
    isDefault: true,
    maxWidth: '600px',
    blocks: [
      { id: 'block_header', kind: 'header-logo', required: false, config: {} },
      { id: 'block_heading', kind: 'heading', required: false, config: {} },
      { id: 'block_body', kind: 'body', required: true, config: {} },
      { id: 'block_cta', kind: 'cta-button', required: false, config: { label: 'Learn more', href: '' } },
      { id: 'block_divider', kind: 'divider', required: false, config: {} },
      { id: 'block_signature', kind: 'signature-slot', required: false, config: {} },
      { id: 'block_footer', kind: 'footer', required: false, config: { showPoweredBy: true } },
    ],
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  });
}

/** A minimal template with just a body block — used when "Include Brand" is off. */
export function buildPlainEmailTemplate(siteId: string, id = 'tpl_plain', name = 'Plain'): EmailTemplate {
  const now = new Date().toISOString();
  return EmailTemplateSchema.parse({
    id,
    siteId,
    name,
    isDefault: false,
    maxWidth: '600px',
    blocks: [{ id: 'block_body', kind: 'body', required: true, config: {} }],
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  });
}
