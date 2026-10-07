import { Router } from 'express';
import { requireOwner, requireSiteAccess } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { getStorage } from '../storage/filesystem.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import {
  listThemes,
  getDesignMdCached,
  parseAwesomeDesignMdRef,
  getRemoteDesignMdCached,
  themeNameFromDirId,
} from '../design/awesome-design-md.js';
import { parseDesignMd } from '../design/parse-design-md.js';
import { generateStyleGuideFromIntake, type DesignIntakeInput } from '../design/generate-design-md.js';
import { getEmailFormatStore } from '../storage/email-formats.js';
import { deriveEmailFormatFromStyleGuide } from '../design/email-format.js';
import { nanoid } from 'nanoid';
import { generateStyleSheet, StyleGuideSchema, type StyleGuide } from '../design/style-guide.js';
import {
  validateStyleGuideChange,
  editableSurfaceForScope,
} from '../guardian/validate-style-guide.js';
import { proposeStyleGuideChange } from '../ai/style-chat.js';
import { resolveAiKeys } from '../integrations/resolve.js';
import { mediaPublicPath } from '../wordpress/import/media-migrator.js';
import {
  extractBrandFromUrl,
  extractedBrandToStyleGuidePatch,
  ExtractedBrandSchema,
  type ExtractedBrand,
} from '../design/brand-extract.js';

/** Standard design-route payload: the guide plus its rendered stylesheet, so UI previews share the one stylesheet source. */
function guidePayload(guide: StyleGuide) {
  return { styleGuide: guide, stylesheet: generateStyleSheet(guide) };
}

const router = Router();

/**
 * Brand-sync: the first time a site gets a StyleGuide, derive a default EmailFormat
 * from it so outbound email starts in sync with the web brand. Only runs once —
 * gated on the site not already having a styleGuideId — and never overwrites an
 * existing (possibly customized) EmailFormat on subsequent theme changes.
 */
async function syncEmailFormatIfFirstStyleGuide(siteId: string, hadStyleGuideBefore: boolean, guide: StyleGuide) {
  if (hadStyleGuideBefore) return;
  try {
    const store = await getEmailFormatStore();
    await store.save(deriveEmailFormatFromStyleGuide(guide, siteId));
  } catch {
    // Non-fatal — the user can still manually sync/create an EmailFormat later.
  }
}

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

router.get('/design/themes', requireOwner, (_req, res) => {
  res.json({ themes: listThemes() });
});

router.get('/sites/:siteId/design/preview/:themeId', requireOwner, async (req, res) => {
  try {
    const themeId = routeParam(req.params.themeId);
    const theme = listThemes().find((t) => t.id === themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    let rawMd = '';
    try {
      rawMd = await getDesignMdCached(themeId);
    } catch {
      rawMd = `# ${theme.name}\n${theme.desc}`;
    }

    const guide = await parseDesignMd(rawMd, themeId, theme.name, theme.aesthetic);
    res.json(guidePayload(guide));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

/**
 * Resolve a theme referenced by URL (or bare upstream dir id) into a parsed
 * StyleGuide. Covers any theme in the awesome-design-md collection, not just
 * the vendored 12. Throws with a user-facing message on bad refs.
 */
async function styleGuideFromThemeUrl(url: string): Promise<StyleGuide> {
  const dirId = parseAwesomeDesignMdRef(url);
  if (!dirId) {
    throw new Error(
      'Not a recognized awesome-design-md URL — paste a link to a DESIGN.md inside github.com/VoltAgent/awesome-design-md'
    );
  }
  const rawMd = await getRemoteDesignMdCached(dirId);
  const manifestEntry = listThemes().find((t) => t.id === dirId);
  const name = manifestEntry?.name ?? themeNameFromDirId(dirId);
  const aesthetic = manifestEntry?.aesthetic ?? 'From awesome-design-md';
  return parseDesignMd(rawMd, dirId, name, aesthetic);
}

router.post('/sites/:siteId/design/preview-url', requireOwner, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url?.trim()) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const guide = await styleGuideFromThemeUrl(url);
    res.json(guidePayload(guide));
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

router.post('/sites/:siteId/design/apply', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { themeId, url } = req.body as { themeId?: string; url?: string };
    if (!themeId && !url) {
      res.status(400).json({ error: 'themeId or url is required' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    let guide: StyleGuide;
    if (url) {
      guide = await styleGuideFromThemeUrl(url);
    } else {
      const theme = listThemes().find((t) => t.id === themeId);
      if (!theme) {
        res.status(404).json({ error: 'Theme not found' });
        return;
      }

      let rawMd = '';
      try {
        rawMd = await getDesignMdCached(theme.id);
      } catch {
        rawMd = `# ${theme.name}\n${theme.desc}`;
      }

      guide = await parseDesignMd(rawMd, theme.id, theme.name, theme.aesthetic);
    }
    const hadStyleGuideBefore = !!site.meta.styleGuideId;
    const store = await getStyleGuideStore();
    await store.save(siteId, guide);
    await storage.updateSiteMeta(siteId, { styleGuideId: guide.meta.id });
    await syncEmailFormatIfFirstStyleGuide(siteId, hadStyleGuideBefore, guide);

    res.json(guidePayload(guide));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Apply failed' });
  }
});

/** One or more plain path segments — no query/fragment, backslashes, or whitespace. */
const MEDIA_REL_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * True only for one of THIS site's media uploads: the root-relative `publicPath` that
 * POST /sites/:siteId/media/upload returns (`/media/<siteId>/wp-content/uploads/<file>`,
 * the same mediaPublicPath shape the WordPress media migrator writes). Another site's
 * media, external/absolute URLs, data:/javascript: URIs, and '..' climbs are all rejected —
 * the pointer ends up as an email <img src>.
 */
export function isSiteMediaUploadPath(siteId: string, url: string): boolean {
  const prefix = mediaPublicPath(siteId, '');
  if (!url.startsWith(prefix)) return false;
  const rel = url.slice(prefix.length);
  return MEDIA_REL_PATH.test(rel) && !rel.split('/').some((seg) => seg === '.' || seg === '..');
}

/** Raster formats every major email client renders (Outlook desktop has no SVG or WebP). */
const EMAIL_RASTER_EXT = /\.(png|jpe?g|gif)$/i;

export type DesignImportBody =
  | {
      ok: true;
      rawDesignMd: string;
      name: string;
      aesthetic: string;
      logo?: { url: string; alt: string; rasterUrl?: string };
    }
  | { ok: false; error: string };

/**
 * Parse + validate the /design/import body. Pure — unit-tested directly. The optional
 * logo pointer must be one of this site's own media uploads (isSiteMediaUploadPath); its
 * optional `rasterUrl` — the PNG rendition branded email uses — must also be a PNG/JPEG/GIF.
 */
export function parseDesignImportBody(siteId: string, body: unknown): DesignImportBody {
  const { rawDesignMd, name, aesthetic, logo } = (body ?? {}) as {
    rawDesignMd?: unknown;
    name?: unknown;
    aesthetic?: unknown;
    logo?: { url?: unknown; alt?: unknown; rasterUrl?: unknown } | null;
  };
  if (typeof rawDesignMd !== 'string' || !rawDesignMd.trim()) return { ok: false, error: 'rawDesignMd is required' };
  if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'name is required' };
  const fields = {
    rawDesignMd,
    name: name.trim(),
    aesthetic: (typeof aesthetic === 'string' && aesthetic.trim()) || 'Imported DESIGN.md',
  };
  if (logo === undefined || logo === null) return { ok: true, ...fields };

  const notMedia = (field: string) =>
    `${field} must be a media upload for this site (the publicPath from POST /sites/:siteId/media/upload)`;
  const url = typeof logo.url === 'string' ? logo.url.trim() : '';
  if (!url) return { ok: false, error: 'logo.url is required when logo is provided' };
  if (!isSiteMediaUploadPath(siteId, url)) return { ok: false, error: notMedia('logo.url') };
  const alt = typeof logo.alt === 'string' ? logo.alt : '';
  if (logo.rasterUrl === undefined || logo.rasterUrl === null) return { ok: true, ...fields, logo: { url, alt } };

  const rasterUrl = typeof logo.rasterUrl === 'string' ? logo.rasterUrl.trim() : '';
  if (!isSiteMediaUploadPath(siteId, rasterUrl)) return { ok: false, error: notMedia('logo.rasterUrl') };
  if (!EMAIL_RASTER_EXT.test(rasterUrl)) {
    return { ok: false, error: 'logo.rasterUrl must be a PNG, JPEG, or GIF (email clients do not render SVG)' };
  }
  return { ok: true, ...fields, logo: { url, alt, rasterUrl } };
}

/**
 * POST /sites/:siteId/design/import
 * Brand Studio handoff: accept a raw DESIGN.md authored outside the app (e.g. by the
 * freshpress-brand-studio skill), parse it into a StyleGuide, and activate it for the
 * site exactly as apply does. An optional logo pointer (a durable /media/upload URL,
 * never inline markup) rides along onto the guide.
 */
router.post('/sites/:siteId/design/import', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const body = parseDesignImportBody(siteId, req.body);
    if (!body.ok) {
      res.status(400).json({ error: body.error });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const themeId = `custom_${nanoid(8)}`;
    const parsed = await parseDesignMd(body.rawDesignMd, themeId, body.name, body.aesthetic);
    const guide = StyleGuideSchema.parse({
      ...parsed,
      meta: { ...parsed.meta, source: 'manual' as const, sourceRef: siteId, name: body.name },
      ...(body.logo ? { logo: body.logo } : {}),
    });

    const hadStyleGuideBefore = !!site.meta.styleGuideId;
    const store = await getStyleGuideStore();
    await store.save(siteId, guide);
    await storage.updateSiteMeta(siteId, { styleGuideId: guide.meta.id });
    await syncEmailFormatIfFirstStyleGuide(siteId, hadStyleGuideBefore, guide);

    res.json(guidePayload(guide));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

router.get('/sites/:siteId/design', siteAuth, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const store = await getStyleGuideStore();
  const guide = await store.get(siteId);
  if (!guide) {
    res.status(404).json({ error: 'No style guide for this site' });
    return;
  }
  res.json(guidePayload(guide));
});

export type DesignGenerateBody =
  | { ok: true; intake: DesignIntakeInput; extracted?: ExtractedBrand }
  | { ok: false; error: string };

/**
 * Chunk 9 (Phase 7a) — parse + validate the /design/generate body. The wizard's
 * Step-5 "extract brand from URL" result rides along as an optional `extracted`
 * (Amendment F forward-staged the merge in generateStyleGuideFromIntake); a
 * present-but-malformed one is rejected rather than silently dropped, so an
 * accepted extraction can never quietly not make it into the theme. Pure —
 * unit-tested directly.
 */
export function parseDesignGenerateBody(body: unknown): DesignGenerateBody {
  const { extracted: extractedRaw, ...intake } = (body ?? {}) as DesignIntakeInput & { extracted?: unknown };
  if (!intake.brandName?.trim()) return { ok: false, error: 'brandName is required' };
  if (!Array.isArray(intake.personality) || intake.personality.length === 0) {
    return { ok: false, error: 'personality (array) is required' };
  }
  if (extractedRaw === undefined || extractedRaw === null) return { ok: true, intake };
  const parsed = ExtractedBrandSchema.safeParse(extractedRaw);
  if (!parsed.success) {
    return { ok: false, error: 'extracted does not match the ExtractedBrand shape from /design/extract-brand' };
  }
  return { ok: true, intake, extracted: parsed.data };
}

/**
 * POST /sites/:siteId/design/generate
 * fp-opendesign intake pattern: brand details → AI-generated DESIGN.md → StyleGuide.
 * Saves and activates the guide for the site exactly as apply does. Accepts an
 * optional `extracted` (ExtractedBrand) merged in as high-priority evidence.
 */
router.post('/sites/:siteId/design/generate', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const parsed = parseDesignGenerateBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { intake, extracted } = parsed;

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    // A missing key is a setup problem, not a server fault: 400, as POST /generate answers it.
    if (!(await resolveAiKeys())) {
      res.status(400).json({ error: 'No AI provider configured. Add an Anthropic or OpenRouter key in Admin → Integrations.' });
      return;
    }

    const { rawDesignMd, styleGuide } = await generateStyleGuideFromIntake(
      intake,
      siteId,
      extracted ? { extracted } : undefined
    );

    const hadStyleGuideBefore = !!site.meta.styleGuideId;
    const store = await getStyleGuideStore();
    await store.save(siteId, styleGuide);
    await storage.updateSiteMeta(siteId, { styleGuideId: styleGuide.meta.id });
    await syncEmailFormatIfFirstStyleGuide(siteId, hadStyleGuideBefore, styleGuide);

    res.json({ ...guidePayload(styleGuide), rawDesignMd });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generate failed' });
  }
});

/**
 * POST /sites/:siteId/design/extract-brand { url }
 * Amendment F: point at a URL and get a reviewable brand draft (colors/fonts/logo).
 * Firecrawl when a key resolves, heuristic (fetch + cheerio + AI normalize) otherwise;
 * never a silent overwrite — returns the draft plus a ready-to-apply StyleGuide patch the
 * client applies through the existing validated PATCH /design path only on explicit accept.
 */
router.post('/sites/:siteId/design/extract-brand', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { url } = req.body as { url?: string };
    if (!url?.trim()) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      res.status(400).json({ error: 'url must be a valid absolute URL (include https://)' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'url must be an http(s) URL' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const extracted = await extractBrandFromUrl(parsed.toString());
    res.json({ extracted, patch: extractedBrandToStyleGuidePatch(extracted) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Brand extraction failed' });
  }
});

/**
 * GET /sites/:siteId/design/editable?elementType=InfoCard
 * The editable StyleGuide surface (whitelisted fields + current values), optionally scoped to
 * one element type. The Site Theme page's structured JSON panel renders this so the client never
 * duplicates the server's whitelist — same source the chat prompt uses.
 */
router.get('/sites/:siteId/design/editable', requireOwner, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const elementType = typeof req.query.elementType === 'string' ? req.query.elementType : undefined;
  const store = await getStyleGuideStore();
  const guide = await store.get(siteId);
  if (!guide) {
    res.status(404).json({ error: 'No style guide for this site' });
    return;
  }
  res.json({ elementType: elementType ?? null, fields: editableSurfaceForScope(guide, elementType) });
});

/** Validate a StyleGuide patch, persist it, and return the refreshed guide+stylesheet. Shared by the JSON panel (PATCH) and the theme chat, so both write through the one validated path. */
async function applyGuidePatch(
  res: import('express').Response,
  siteId: string,
  current: StyleGuide,
  patch: unknown,
  elementType?: string
): Promise<StyleGuide | null> {
  const result = validateStyleGuideChange(current, patch, elementType ? { elementType } : undefined);
  if (!result.ok) {
    res.status(422).json({ error: 'Guardian rejected theme change', guardianErrors: result.errors });
    return null;
  }
  const store = await getStyleGuideStore();
  const saved = await store.save(siteId, result.applied!);
  return saved;
}

/**
 * PATCH /sites/:siteId/design
 * Structured edit surface for the Site Theme page. Body: { patch, elementType? }.
 * `patch` is a deep-partial of the StyleGuide; `elementType` (if present) confines the change
 * to that type's token group. Validated through validateStyleGuideChange.
 */
router.patch('/sites/:siteId/design', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { patch, elementType } = req.body as { patch?: unknown; elementType?: string };
    if (patch === undefined) {
      res.status(400).json({ error: 'patch is required' });
      return;
    }

    const store = await getStyleGuideStore();
    const current = await store.get(siteId);
    if (!current) {
      res.status(404).json({ error: 'No style guide for this site' });
      return;
    }

    const saved = await applyGuidePatch(res, siteId, current, patch, elementType);
    if (!saved) return;
    res.json(guidePayload(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Patch failed' });
  }
});

/**
 * POST /sites/:siteId/design/chat
 * Site-scoped theme chat (open-question #1: a new endpoint, not the per-page /chat). Body:
 * { message, elementType? }. The AI proposes a StyleGuide patch; it is applied only if it
 * passes the same validateStyleGuideChange the JSON panel uses.
 */
type ThemeChatRun =
  | { error: { status: number; body: Record<string, unknown> } }
  | {
      proposal: Awaited<ReturnType<typeof proposeStyleGuideChange>>;
      result: ReturnType<typeof validateStyleGuideChange>;
    };

/**
 * Load the guide, ask the AI for a patch, and validate it — the shared preamble for both the apply
 * and preview theme-chat endpoints, so a dry-run preview can never validate under different rules
 * than the real apply. customCss is stripped: raw site CSS is a panel-only surface, never chat-writable.
 */
async function runThemeChat(siteId: string, message: string, elementType?: string): Promise<ThemeChatRun> {
  const store = await getStyleGuideStore();
  const [current, aiKeys] = await Promise.all([store.get(siteId), resolveAiKeys()]);
  if (!current) return { error: { status: 404, body: { error: 'No style guide for this site' } } };

  const scope = elementType ? { elementType } : undefined;
  const proposal = await proposeStyleGuideChange({ message, guide: current, scope }, aiKeys);
  if (proposal.patch && typeof proposal.patch === 'object') {
    delete (proposal.patch as Record<string, unknown>).customCss;
  }
  const result = validateStyleGuideChange(current, proposal.patch, scope);
  return { proposal, result };
}

router.post('/sites/:siteId/design/chat', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { message, elementType } = req.body as { message?: string; elementType?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const run = await runThemeChat(siteId, message.trim(), elementType);
    if ('error' in run) {
      res.status(run.error.status).json(run.error.body);
      return;
    }
    const { proposal, result } = run;
    if (!result.ok) {
      res.status(422).json({
        error: 'Guardian rejected AI theme proposal',
        explanation: proposal.explanation,
        provider: proposal.provider,
        guardianErrors: result.errors,
        proposedPatch: proposal.patch,
      });
      return;
    }

    const store = await getStyleGuideStore();
    const saved = await store.save(siteId, result.applied!);
    res.json({
      ok: true,
      explanation: proposal.explanation,
      provider: proposal.provider,
      patch: proposal.patch,
      ...guidePayload(saved),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Theme chat failed' });
  }
});

/** POST /sites/:siteId/design/chat/preview — same validation as /chat but never persists (dry run). */
router.post('/sites/:siteId/design/chat/preview', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { message, elementType } = req.body as { message?: string; elementType?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const run = await runThemeChat(siteId, message.trim(), elementType);
    if ('error' in run) {
      res.status(run.error.status).json(run.error.body);
      return;
    }
    const { proposal, result } = run;
    res.json({
      explanation: proposal.explanation,
      provider: proposal.provider,
      patch: proposal.patch,
      guardian: { ok: result.ok, errors: result.errors },
      preview: result.ok ? guidePayload(result.applied!) : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Theme chat preview failed' });
  }
});

export default router;
