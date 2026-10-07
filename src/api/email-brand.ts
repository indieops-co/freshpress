import { Router } from 'express';
import { nanoid } from 'nanoid';
import { requireOwner } from '../auth/middleware.js';
import { requireFeature } from '../auth/entitlements.js';
import { routeParam } from '../util/params.js';
import { getStorage } from '../storage/filesystem.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { getEmailFormatStore } from '../storage/email-formats.js';
import { getEmailTemplateStore } from '../storage/email-templates.js';
import { EmailFormatSchema, deriveEmailFormatFromStyleGuide, buildBlankEmailFormat } from '../design/email-format.js';
import { EmailTemplateSchema, buildDefaultEmailTemplate } from '../design/email-template.js';
import { renderBrandedEmail, isSvgImageUrl } from '../email/brand-render.js';
import { sendBrandedEmail } from '../email/send.js';
import {
  EmailFormatUpdateSchema,
  EmailTemplateUpdateSchema,
  EmailBrandDefaultsSchema,
  ComposeSendSchema,
  ComposePreviewSchema,
  ImportFromSiteSchema,
} from '../email/validate.js';

const router = Router();

// Email system is a paid feature: every admin-side email route carries the tier
// gate. (The Resend inbound webhook and public form-submission routes are separate
// and deliberately ungated.)
const requireEmailSystem = requireFeature('emailSystem');

function tokensChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// ── Email Formats ────────────────────────────────────────────────────────────

router.get('/sites/:siteId/email-formats', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailFormatStore();
  const formats = await store.list(routeParam(req.params.siteId));
  res.json({ formats });
});

router.post('/sites/:siteId/email-formats', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const parsed = EmailFormatUpdateSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const id = `ef_${nanoid(10)}`;
    const blank = buildBlankEmailFormat(siteId, id, parsed.data.name ?? 'New Format');
    const format = EmailFormatSchema.parse({ ...blank, ...parsed.data, id, siteId });
    const store = await getEmailFormatStore();
    const saved = await store.save(format);
    res.json({ format: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Create failed' });
  }
});

router.get('/sites/:siteId/email-formats/:id', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailFormatStore();
  const format = await store.get(routeParam(req.params.siteId), routeParam(req.params.id));
  if (!format) {
    res.status(404).json({ error: 'Format not found' });
    return;
  }
  res.json({ format });
});

router.put('/sites/:siteId/email-formats/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const store = await getEmailFormatStore();
    const existing = await store.get(siteId, id);
    if (!existing) {
      res.status(404).json({ error: 'Format not found' });
      return;
    }
    const parsed = EmailFormatUpdateSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const merged = { ...existing, ...parsed.data, id, siteId };
    const tokensDiffer =
      tokensChanged(existing.colors, merged.colors) ||
      tokensChanged(existing.typography, merged.typography) ||
      tokensChanged(existing.spacing, merged.spacing) ||
      tokensChanged(existing.button, merged.button);
    if (tokensDiffer && existing.provenance.source === 'style-guide-sync' && !existing.provenance.customized) {
      merged.provenance = { ...existing.provenance, customized: true };
    }
    const saved = await store.save(EmailFormatSchema.parse(merged));
    res.json({ format: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

router.delete('/sites/:siteId/email-formats/:id', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailFormatStore();
  await store.delete(routeParam(req.params.siteId), routeParam(req.params.id));
  res.status(204).end();
});

router.post('/sites/:siteId/email-formats/:id/set-default', requireOwner, requireEmailSystem, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const store = await getEmailFormatStore();
  await store.setDefault(siteId, routeParam(req.params.id));
  res.json({ formats: await store.list(siteId) });
});

/** Brand-sync entrypoint: derive a fresh EmailFormat from this site's current StyleGuide. */
router.post('/sites/:siteId/email-formats/sync-from-style-guide', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const guideStore = await getStyleGuideStore();
    const guide = await guideStore.get(siteId);
    if (!guide) {
      res.status(400).json({ error: 'This site has no StyleGuide yet — set up its design system first' });
      return;
    }
    const { overwriteId } = (req.body ?? {}) as { overwriteId?: string };
    const store = await getEmailFormatStore();

    if (overwriteId) {
      const existing = await store.get(siteId, overwriteId);
      if (existing && !existing.provenance.customized) {
        const derived = deriveEmailFormatFromStyleGuide(guide, siteId, { id: overwriteId, name: existing.name });
        const saved = await store.save(derived);
        res.json({ format: saved });
        return;
      }
    }

    const derived = deriveEmailFormatFromStyleGuide(guide, siteId);
    const saved = await store.save(derived);
    res.json({ format: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

router.post('/sites/:siteId/email-formats/:id/export', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailFormatStore();
  const format = await store.get(routeParam(req.params.siteId), routeParam(req.params.id));
  if (!format) {
    res.status(404).json({ error: 'Format not found' });
    return;
  }
  const { id, siteId, ...payload } = format;
  res.json({ payload, kind: 'email-format' as const, schemaVersion: 1 });
});

router.post('/sites/:siteId/email-formats/import', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const targetSiteId = routeParam(req.params.siteId);
    const body = req.body as { payload?: unknown; sourceSiteId?: string };
    const parsedPayload = EmailFormatSchema.omit({ id: true, siteId: true }).safeParse(body?.payload);
    if (!parsedPayload.success) {
      res.status(400).json({ error: 'Invalid Email Format payload' });
      return;
    }
    const now = new Date().toISOString();
    const imported = EmailFormatSchema.parse({
      ...parsedPayload.data,
      id: `ef_${nanoid(10)}`,
      siteId: targetSiteId,
      isDefault: false,
      provenance: {
        source: 'imported',
        sourceRef: parsedPayload.data.provenance?.sourceRef,
        sourceSiteId: body.sourceSiteId,
        customized: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    const store = await getEmailFormatStore();
    const saved = await store.save(imported);
    res.json({ format: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

router.post('/sites/:siteId/email-formats/import-from-site', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const targetSiteId = routeParam(req.params.siteId);
    const parsed = ImportFromSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'sourceSiteId and sourceId are required' });
      return;
    }
    const store = await getEmailFormatStore();
    const source = await store.get(parsed.data.sourceSiteId, parsed.data.sourceId);
    if (!source) {
      res.status(404).json({ error: 'Source format not found' });
      return;
    }
    const now = new Date().toISOString();
    const imported = EmailFormatSchema.parse({
      ...source,
      id: `ef_${nanoid(10)}`,
      siteId: targetSiteId,
      isDefault: false,
      provenance: {
        source: 'imported',
        sourceRef: source.id,
        sourceSiteId: parsed.data.sourceSiteId,
        customized: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    const saved = await store.save(imported);
    res.json({ format: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

// ── Email Templates (same shape as Formats, minus style-guide sync) ─────────

router.get('/sites/:siteId/email-templates', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailTemplateStore();
  const templates = await store.list(routeParam(req.params.siteId));
  res.json({ templates });
});

router.post('/sites/:siteId/email-templates', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const parsed = EmailTemplateUpdateSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const id = `et_${nanoid(10)}`;
    const seed = buildDefaultEmailTemplate(siteId, id, parsed.data.name ?? 'New Template');
    const template = EmailTemplateSchema.parse({ ...seed, ...parsed.data, id, siteId });
    const store = await getEmailTemplateStore();
    const saved = await store.save(template);
    res.json({ template: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Create failed' });
  }
});

router.get('/sites/:siteId/email-templates/:id', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailTemplateStore();
  const template = await store.get(routeParam(req.params.siteId), routeParam(req.params.id));
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  res.json({ template });
});

router.put('/sites/:siteId/email-templates/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const store = await getEmailTemplateStore();
    const existing = await store.get(siteId, id);
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const parsed = EmailTemplateUpdateSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const saved = await store.save(EmailTemplateSchema.parse({ ...existing, ...parsed.data, id, siteId }));
    res.json({ template: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

router.delete('/sites/:siteId/email-templates/:id', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailTemplateStore();
  await store.delete(routeParam(req.params.siteId), routeParam(req.params.id));
  res.status(204).end();
});

router.post('/sites/:siteId/email-templates/:id/set-default', requireOwner, requireEmailSystem, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const store = await getEmailTemplateStore();
  await store.setDefault(siteId, routeParam(req.params.id));
  res.json({ templates: await store.list(siteId) });
});

router.post('/sites/:siteId/email-templates/:id/export', requireOwner, requireEmailSystem, async (req, res) => {
  const store = await getEmailTemplateStore();
  const template = await store.get(routeParam(req.params.siteId), routeParam(req.params.id));
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  const { id, siteId, ...payload } = template;
  res.json({ payload, kind: 'email-template' as const, schemaVersion: 1 });
});

router.post('/sites/:siteId/email-templates/import', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const targetSiteId = routeParam(req.params.siteId);
    const body = req.body as { payload?: unknown };
    const parsedPayload = EmailTemplateSchema.omit({ id: true, siteId: true }).safeParse(body?.payload);
    if (!parsedPayload.success) {
      res.status(400).json({ error: 'Invalid Email Template payload' });
      return;
    }
    const now = new Date().toISOString();
    const imported = EmailTemplateSchema.parse({
      ...parsedPayload.data,
      id: `et_${nanoid(10)}`,
      siteId: targetSiteId,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    const store = await getEmailTemplateStore();
    const saved = await store.save(imported);
    res.json({ template: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

router.post('/sites/:siteId/email-templates/import-from-site', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const targetSiteId = routeParam(req.params.siteId);
    const parsed = ImportFromSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'sourceSiteId and sourceId are required' });
      return;
    }
    const store = await getEmailTemplateStore();
    const source = await store.get(parsed.data.sourceSiteId, parsed.data.sourceId);
    if (!source) {
      res.status(404).json({ error: 'Source template not found' });
      return;
    }
    const now = new Date().toISOString();
    const imported = EmailTemplateSchema.parse({
      ...source,
      id: `et_${nanoid(10)}`,
      siteId: targetSiteId,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await store.save(imported);
    res.json({ template: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

// ── Brand defaults ───────────────────────────────────────────────────────────

router.get('/sites/:siteId/email-brand-defaults', requireOwner, requireEmailSystem, async (req, res) => {
  const storage = await getStorage();
  const site = await storage.getSite(routeParam(req.params.siteId));
  if (!site) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }
  res.json({
    brandDefaults: site.meta.emailBrandDefaults ?? {
      includeBrandDefault: true,
      includeSignatureDefault: true,
    },
  });
});

router.put('/sites/:siteId/email-brand-defaults', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const parsed = EmailBrandDefaultsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const storage = await getStorage();
    const meta = await storage.updateSiteMeta(routeParam(req.params.siteId), {
      emailBrandDefaults: parsed.data,
    });
    res.json({ brandDefaults: meta.emailBrandDefaults });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save brand defaults' });
  }
});

// ── Compose: preview + send ──────────────────────────────────────────────────

/**
 * The header-logo <img src> for a StyleGuide logo pointer, or undefined (→ the block
 * renders the site name). Prefers the raster rendition; never returns an SVG, since
 * Gmail and Outlook desktop don't render SVG in <img>. The StyleGuide holds media-upload
 * paths and email clients need absolute URLs, so relative paths resolve against APP_URL
 * (trailing slash stripped — same convention as connect.ts / email-inbound.ts).
 */
export function resolveEmailLogoUrl(
  logo: { url: string; rasterUrl?: string } | undefined,
  appUrl: string = process.env.APP_URL ?? 'http://localhost:3001'
): string | undefined {
  const path = [logo?.rasterUrl, logo?.url].find((u) => u && !isSvgImageUrl(u));
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${appUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

export async function loadComposeInput(
  siteId: string,
  body: { formatId: string; templateId: string; subject: string; previewText?: string; bodyHtml: string; includeBrand: boolean; includeSignature: boolean },
  siteName: string
) {
  const formatStore = await getEmailFormatStore();
  const templateStore = await getEmailTemplateStore();
  const format = await formatStore.get(siteId, body.formatId);
  const template = await templateStore.get(siteId, body.templateId);
  if (!format) throw new Error('Format not found');
  if (!template) throw new Error('Template not found');

  const storage = await getStorage();
  const site = await storage.getSite(siteId);

  // Brand logo for the header-logo block (raster only — see resolveEmailLogoUrl).
  let logoUrl: string | undefined;
  try {
    const guide = await (await getStyleGuideStore()).get(siteId);
    logoUrl = resolveEmailLogoUrl(guide?.logo);
  } catch {
    // Non-fatal — the header-logo block falls back to the site name.
  }

  return {
    format,
    template,
    subject: body.subject,
    previewText: body.previewText,
    bodyHtml: body.bodyHtml,
    includeBrand: body.includeBrand,
    includeSignature: body.includeSignature,
    signature: site?.meta.emailBrandDefaults?.signature,
    siteName,
    logoUrl,
  };
}

router.post('/sites/:siteId/email-compose/preview', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const parsed = ComposePreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    const input = await loadComposeInput(siteId, parsed.data, site.meta.name);
    const html = await renderBrandedEmail(input);
    res.json({ html });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

router.post('/sites/:siteId/email-compose/send', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const parsed = ComposeSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site?.meta.email) {
      res.status(400).json({ error: 'Configure email settings first' });
      return;
    }
    const input = await loadComposeInput(siteId, parsed.data, site.meta.name);
    const html = await renderBrandedEmail(input);
    const result = await sendBrandedEmail(site.meta.email, {
      to: parsed.data.to,
      subject: parsed.data.subject,
      html,
    });
    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Send failed' });
  }
});

export default router;
