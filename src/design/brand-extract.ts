/**
 * Amendment F — Brand extraction from a URL.
 *
 * User points at a URL (their old site, a site they love) and gets a mostly
 * filled-in Site Theme page. One `extractBrandFromUrl(url)` function, two
 * engines behind it, one normalized `ExtractedBrand` output shape:
 *
 *  - Firecrawl engine (when `firecrawl_api_key` resolves via vault or env):
 *    `POST https://api.firecrawl.dev/v2/scrape { formats: ['branding'] }`, higher
 *    fidelity — the user never writes a Firecrawl prompt.
 *  - Heuristic engine (no key, or Firecrawl failed): plain fetch (ingest UA) +
 *    cheerio to collect evidence, then one AI pass normalizes it to the same
 *    shape. If no AI is configured, a pure evidence→brand fallback still returns
 *    a (lower-confidence) result.
 *
 * Firecrawl failure falls through to the heuristic engine automatically; total
 * failure returns an empty-but-valid draft (as if extraction was skipped) — it
 * must never block generation. The endpoint returns a reviewable draft; nothing
 * is applied to a site without an explicit user action.
 *
 * Testability: every mapper/collector/merger is a pure exported function tested
 * with realistic fixtures; only the three `fetch` boundaries
 * (`fetchFirecrawlBranding`, `fetchPageHtml`, the AI call) are un-unit-tested.
 */
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { resolveSecret, resolveAiKeys } from '../integrations/resolve.js';
import { callAiJson, extractJsonValue } from '../ai/call-json.js';
import type { DesignIntakeInput } from './generate-design-md.js';
import type { StyleGuide } from './style-guide.js';

// ── Output shape ─────────────────────────────────────────────────────────────

/** Confidence in [0,1] per extracted section — low when heuristic-only, higher via Firecrawl. */
export const BrandConfidenceSchema = z.object({
  colors: z.number().min(0).max(1),
  typography: z.number().min(0).max(1),
  radii: z.number().min(0).max(1),
  shadows: z.number().min(0).max(1),
  logo: z.number().min(0).max(1),
});
export type BrandConfidence = z.infer<typeof BrandConfidenceSchema>;

/**
 * A reviewable brand draft: `Partial<StyleGuide>` slices the user can accept.
 * Colors mirror the named StyleGuide color roles (all optional); typography is
 * font names only; radii/shadows are coarse hints; `logoUrl` is informational
 * (the StyleGuide schema has no logo token, so it is shown but not auto-applied).
 */
export const ExtractedBrandSchema = z.object({
  colors: z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
      background: z.string().optional(),
      surface: z.string().optional(),
      text: z.string().optional(),
      textMuted: z.string().optional(),
      border: z.string().optional(),
    })
    .default({}),
  typography: z
    .object({
      headingFont: z.string().optional(),
      bodyFont: z.string().optional(),
      monoFont: z.string().optional(),
    })
    .default({}),
  radii: z.object({ md: z.string().optional() }).default({}),
  shadows: z.object({ md: z.string().optional() }).default({}),
  logoUrl: z.string().optional(),
  confidence: BrandConfidenceSchema,
  engine: z.enum(['firecrawl', 'heuristic']),
  sourceUrl: z.string(),
});
export type ExtractedBrand = z.infer<typeof ExtractedBrandSchema>;

const ZERO_CONFIDENCE: BrandConfidence = { colors: 0, typography: 0, radii: 0, shadows: 0, logo: 0 };

/** An empty-but-valid draft — the "as if skipped" result on total failure. */
export function emptyExtractedBrand(url: string, engine: 'firecrawl' | 'heuristic' = 'heuristic'): ExtractedBrand {
  return { colors: {}, typography: {}, radii: {}, shadows: {}, confidence: { ...ZERO_CONFIDENCE }, engine, sourceUrl: url };
}

// ── Raw page evidence (heuristic engine) ─────────────────────────────────────

export interface ColorCandidate {
  value: string;
  count: number;
}

export interface BrandEvidence {
  themeColor?: string;
  /** Candidate colors ranked by frequency across inline styles, <style> blocks, and CSS vars. */
  colors: ColorCandidate[];
  /** Font-family names seen in Google Fonts links and font-family declarations, most-linked first. */
  fontFamilies: string[];
  /** Absolute logo image URLs, best guess first. */
  logoCandidates: string[];
  title?: string;
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /rgba?\([^)]*\)/gi;
// Capture the whole font-family value including any quotes — firstFontName() strips the quotes.
// (Excluding quotes from the class here would make a quoted `font-family: "Gotham"` match only a space.)
const FONT_FAMILY_RE = /font-family\s*:\s*([^;{}]+)/gi;

/** The named StyleGuide color roles the extractor targets — one source, shared by the mappers. */
const COLOR_ROLES = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'textMuted', 'border'] as const;

function resolveUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw, base).toString();
  } catch {
    return undefined;
  }
}

/** First font token from a `font-family` value: "Poppins", sans-serif → "Poppins". */
function firstFontName(familyValue: string): string | null {
  const first = familyValue.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  if (!first) return null;
  const generic = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy']);
  if (generic.has(first.toLowerCase())) return null;
  return first;
}

/**
 * Pure cheerio pass over page HTML → structured evidence. No network, no AI —
 * unit-tested directly against an HTML fixture (fixture-fidelity lesson: the
 * fixture uses real Google-Fonts link syntax, CSS custom properties, and
 * logo/og markup, not a simplified stand-in).
 */
export function collectBrandEvidence(html: string, baseUrl: string): BrandEvidence {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || undefined;
  const themeColor = $('meta[name="theme-color"]').attr('content')?.trim() || undefined;

  // Fonts: Google Fonts <link> `family=` params (ranked by appearance) + font-family declarations.
  const fontOrder: string[] = [];
  const seenFonts = new Set<string>();
  const addFont = (name: string | null) => {
    if (!name) return;
    const key = name.toLowerCase();
    if (seenFonts.has(key)) return;
    seenFonts.add(key);
    fontOrder.push(name);
  };
  $('link[rel="stylesheet"], link[rel="preload"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (!/fonts\.googleapis\.com|fonts\.gstatic\.com|typekit|fonts\.bunny/i.test(href)) return;
    for (const m of href.matchAll(/family=([^&:]+)/gi)) {
      addFont(decodeURIComponent(m[1].replace(/\+/g, ' ')).split(':')[0].trim());
    }
  });

  // Colors + font-family declarations from inline style attrs, <style> blocks, and CSS vars.
  const colorCounts = new Map<string, number>();
  const bump = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    colorCounts.set(value, (colorCounts.get(value) ?? 0) + 1);
  };
  const scanCss = (css: string) => {
    for (const m of css.matchAll(HEX_RE)) bump(m[0]);
    for (const m of css.matchAll(RGB_RE)) bump(m[0]);
    for (const m of css.matchAll(FONT_FAMILY_RE)) addFont(firstFontName(m[1]));
  };
  $('style').each((_i, el) => scanCss($(el).text()));
  $('[style]').each((_i, el) => scanCss($(el).attr('style') ?? ''));
  if (themeColor) bump(themeColor);

  const colors: ColorCandidate[] = [...colorCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  // Logo: <img> whose src/alt/class mentions "logo", then og:logo, then favicon.
  const logoCandidates: string[] = [];
  const pushLogo = (u: string | undefined) => {
    const abs = resolveUrl(u, baseUrl);
    if (!abs) return;
    // http(s) only — drop data:/javascript: logo srcs before they reach the preview <img>.
    try {
      if (!/^https?:$/i.test(new URL(abs).protocol)) return;
    } catch {
      return;
    }
    if (!logoCandidates.includes(abs)) logoCandidates.push(abs);
  };
  $('img').each((_i, el) => {
    const $el = $(el);
    const hay = `${$el.attr('src') ?? ''} ${$el.attr('alt') ?? ''} ${$el.attr('class') ?? ''}`.toLowerCase();
    if (hay.includes('logo')) pushLogo($el.attr('src'));
  });
  pushLogo($('meta[property="og:logo"]').attr('content'));
  pushLogo($('link[rel*="icon"]').first().attr('href'));

  return { themeColor, colors, fontFamilies: fontOrder, logoCandidates, title };
}

/**
 * Pure, AI-free fallback: turn raw evidence into an ExtractedBrand with a
 * best-effort role assignment. Confidence stays low — this is the floor when no
 * AI is configured or the AI pass fails.
 */
export function evidenceToExtractedBrand(evidence: BrandEvidence, url: string): ExtractedBrand {
  const brand = emptyExtractedBrand(url, 'heuristic');

  // theme-color (or the most frequent non-neutral color) → primary; the next distinct one → accent.
  const neutral = (v: string) => {
    if (/^#?(fff|ffffff|000|000000)$/i.test(v.replace('#', ''))) return true;
    // Only pure black/white rgb() are neutral — a saturated rgb(0,122,255) is a real brand color.
    return /^rgba?\(\s*0\s*,\s*0\s*,\s*0\b/i.test(v) || /^rgba?\(\s*255\s*,\s*255\s*,\s*255\b/i.test(v);
  };
  const nonNeutral = evidence.colors.filter((c) => !neutral(c.value));
  const primary = evidence.themeColor?.toLowerCase() ?? nonNeutral[0]?.value;
  if (primary) {
    brand.colors.primary = primary;
    // Accent = the most frequent non-neutral color that isn't already the primary (never drops the
    // dominant color when theme-color happens to be a less-frequent one).
    const accent = nonNeutral.find((c) => c.value !== primary)?.value;
    if (accent) brand.colors.accent = accent;
    brand.confidence.colors = 0.35;
  }

  if (evidence.fontFamilies[0]) {
    brand.typography.headingFont = evidence.fontFamilies[0];
    brand.typography.bodyFont = evidence.fontFamilies[1] ?? evidence.fontFamilies[0];
    brand.confidence.typography = 0.4;
  }

  if (evidence.logoCandidates[0]) {
    brand.logoUrl = evidence.logoCandidates[0];
    brand.confidence.logo = 0.4;
  }

  return brand;
}

// ── Firecrawl engine ─────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * A scraped "color" must look like a CSS color literal, not arbitrary CSS.
 * Firecrawl branding values are passed through to inline swatch styles and
 * (via the accepted ExtractedBrand) into StyleGuide token prompts — a value
 * like `url(https://evil/px)` would beacon from the editor. Hex / rgb[a] /
 * hsl[a] / oklch / bare color keywords only.
 */
const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([^()]*\)|(oklch|oklab|lab|lch|color)\([^()]*\)|[a-zA-Z]{3,25})$/;
const safeColor = (v: string | undefined): string | undefined =>
  v && CSS_COLOR_RE.test(v) ? v : undefined;

/** http(s) and inline data:image URIs are safe for an <img> preview; everything else is dropped. */
function safeImageUrl(raw: string | undefined, base: string): string | undefined {
  const abs = resolveUrl(raw, base);
  if (!abs) return undefined;
  try {
    const proto = new URL(abs).protocol.toLowerCase();
    if (proto === 'http:' || proto === 'https:') return abs;
    if (proto === 'data:' && /^data:image\//i.test(abs)) return abs;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Map a Firecrawl v2 `branding`-format response to ExtractedBrand.
 *
 * Field paths were confirmed against a real api.firecrawl.dev/v2/scrape response:
 *   data.branding = {
 *     colors: { primary, secondary, accent, background, textPrimary, link },   // named; textPrimary = "text" role
 *     fonts: [{ family, role }],                                                 // role: 'body' | 'heading' | …
 *     typography: { fontFamilies: { primary, heading }, fontStacks, fontSizes },
 *     spacing: { baseUnit, borderRadius },
 *     components: { buttonPrimary: { borderRadius, shadow, … }, buttonSecondary },
 *     images: { logo, favicon, ogImage, … },                                    // logo may be a data: URI
 *     confidence: { colors, buttons, overall },
 *   }
 * A few alternate keys / an array-of-colors layout are kept as fallbacks for
 * response variation across sites. Pure — no I/O.
 */
export function mapFirecrawlBranding(payload: unknown, url: string): ExtractedBrand {
  const brand = emptyExtractedBrand(url, 'firecrawl');
  const root = obj(payload);
  const data = obj(root.data ?? root);
  const branding = obj(data.branding ?? obj(data.metadata).branding ?? data);
  if (Object.keys(branding).length === 0) return brand;

  // ── Colors ── named object; Firecrawl exposes the text role as `textPrimary`.
  const colorsNode = branding.colors ?? branding.palette ?? branding.colorPalette;
  const c = obj(colorsNode);
  const colorSources: Record<keyof ExtractedBrand['colors'], unknown> = {
    primary: c.primary,
    secondary: c.secondary,
    accent: c.accent,
    background: c.background,
    surface: c.surface,
    text: c.text ?? c.textPrimary,
    textMuted: c.textMuted ?? c.textSecondary,
    border: c.border,
  };
  for (const key of COLOR_ROLES) {
    const v = safeColor(str(colorSources[key]) ?? str(obj(colorSources[key]).value));
    if (v) brand.colors[key] = v;
  }
  // Fallback: an ordered array of hex strings / { hex } / { value } objects.
  if (Object.keys(brand.colors).length === 0 && Array.isArray(colorsNode)) {
    const values = (colorsNode as unknown[])
      .map((e) => safeColor(typeof e === 'string' ? str(e) : str(obj(e).hex) ?? str(obj(e).value)))
      .filter((v): v is string => !!v);
    if (values[0]) brand.colors.primary = values[0];
    if (values[1]) brand.colors.accent = values[1];
    if (values[2]) brand.colors.background = values[2];
  }

  // ── Typography ── fontFamilies + the fonts[] role list, with older-shape fallbacks.
  const typo = obj(branding.typography ?? branding.fonts);
  const fontFamilies = obj(typo.fontFamilies);
  const fontsByRole: Record<string, string> = {};
  const fontList = Array.isArray(branding.fonts) ? branding.fonts : Array.isArray(typo.fonts) ? typo.fonts : [];
  for (const f of fontList as unknown[]) {
    const fam = str(obj(f).family);
    const role = str(obj(f).role);
    if (fam && role && !fontsByRole[role]) fontsByRole[role] = fam;
  }
  const heading = str(fontFamilies.heading) ?? fontsByRole.heading ?? str(typo.headingFont) ?? str(obj(typo.heading).family) ?? str(typo.heading);
  const body = str(fontFamilies.primary) ?? str(fontFamilies.body) ?? fontsByRole.body ?? str(typo.bodyFont) ?? str(obj(typo.body).family) ?? str(typo.body);
  const mono = str(fontFamilies.mono) ?? fontsByRole.mono ?? str(typo.monoFont);
  if (heading) brand.typography.headingFont = heading;
  if (body) brand.typography.bodyFont = body;
  if (mono) brand.typography.monoFont = mono;

  // ── Radius ── the site-wide spacing.borderRadius, else the primary button's radius.
  const components = obj(branding.components);
  const radius =
    str(obj(branding.spacing).borderRadius) ??
    str(obj(components.buttonPrimary).borderRadius) ??
    str(obj(branding.radii).md) ?? str(branding.borderRadius) ?? str(branding.radius);
  if (radius) brand.radii.md = radius;

  // ── Shadow ── the primary button's shadow (Firecrawl commonly reports "none", which we skip).
  const shadowRaw =
    str(obj(components.buttonPrimary).shadow) ??
    str(obj(components.card).shadow) ??
    str(obj(branding.shadows).md) ?? str(branding.boxShadow) ?? str(branding.shadow);
  if (shadowRaw && shadowRaw.toLowerCase() !== 'none') brand.shadows.md = shadowRaw;

  // ── Logo ── images.logo (often a data: URI), else favicon / ogImage, else older single-key shapes.
  const images = obj(branding.images);
  const logo = safeImageUrl(
    str(images.logo) ?? str(obj(branding.logo).url) ?? str(branding.logo) ?? str(branding.logoUrl) ?? str(images.favicon) ?? str(images.ogImage),
    url
  );
  if (logo) brand.logoUrl = logo;

  // ── Confidence ── Firecrawl's own numbers where present, else a high default per populated section.
  const fc = obj(branding.confidence);
  const fcColors = typeof fc.colors === 'number' ? fc.colors : 0.85;
  const fcOverall = typeof fc.overall === 'number' ? fc.overall : 0.85;
  if (Object.keys(brand.colors).length > 0) brand.confidence.colors = fcColors;
  if (Object.keys(brand.typography).length > 0) brand.confidence.typography = fcOverall;
  if (brand.radii.md) brand.confidence.radii = fcOverall;
  if (brand.shadows.md) brand.confidence.shadows = fcOverall;
  if (brand.logoUrl) brand.confidence.logo = fcOverall;

  return ExtractedBrandSchema.parse(brand);
}

/** Thin fetch boundary for the Firecrawl branding scrape. Throws on non-OK so the caller falls through. */
async function fetchFirecrawlBranding(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['branding'] }),
  });
  if (!res.ok) throw new Error(`Firecrawl error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Heuristic engine (fetch + cheerio + one AI normalize pass) ───────────────

/** Thin fetch boundary for the raw page HTML (same UA as ingest). Throws on non-OK. */
async function fetchPageHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'FreshPress-Ingest/1.0' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Fetch a page and reduce it to readable text (for research prompts). Rides the same
 * fetch boundary as brand extraction so that when the codebase-wide SSRF hardening
 * lands (tracked — fetchPageHtml has no private-IP/scheme guard yet) it covers this
 * path in the same change. Callers own the char budget — no default, so the cap has
 * a single source of truth at the call site.
 */
export async function fetchPageText(url: string, maxChars: number): Promise<string> {
  const html = await fetchPageHtml(url);
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars);
}

/** System + user prompt for the evidence-normalization pass. Pure. */
export function buildNormalizePrompt(evidence: BrandEvidence): { system: string; user: string } {
  const system = `You are a brand analyst. Given raw evidence scraped from a website, infer its brand design tokens.
Assign the observed colors to semantic roles (primary, accent, background, surface, text, textMuted, border) and
choose the real heading and body fonts. Ignore incidental colors (e.g. one-off inline greys). Use the exact color
strings from the evidence; never invent hex values not present in it.

Respond with ONLY valid JSON in this exact shape (omit any field you cannot infer):
{
  "colors": { "primary": "#...", "accent": "#...", "background": "#...", "surface": "#...", "text": "#...", "textMuted": "#...", "border": "#..." },
  "typography": { "headingFont": "Name", "bodyFont": "Name" }
}`;
  const colorLines = evidence.colors.slice(0, 24).map((c) => `- ${c.value} (seen ${c.count}×)`).join('\n') || '- (none found)';
  const user = `Site title: ${evidence.title ?? '(unknown)'}
Theme-color meta: ${evidence.themeColor ?? '(none)'}
Fonts linked/declared (most prominent first): ${evidence.fontFamilies.join(', ') || '(none)'}
Observed colors:
${colorLines}`;
  return { system, user };
}

/**
 * Parse the AI normalize response, keeping only colors that actually appeared in
 * the evidence (guards against invented hex), then backfill logo/confidence.
 * Pure — testable with a canned AI response string.
 */
export function parseNormalizedBrand(text: string, evidence: BrandEvidence, url: string): ExtractedBrand {
  const brand = emptyExtractedBrand(url, 'heuristic');
  const evidenceColors = new Set(evidence.colors.map((c) => c.value.toLowerCase()));
  if (evidence.themeColor) evidenceColors.add(evidence.themeColor.toLowerCase());

  let parsed: { colors?: Record<string, unknown>; typography?: Record<string, unknown> } = {};
  const value = extractJsonValue(text, 'object');
  if (value) {
    parsed = value as typeof parsed;
  }

  for (const key of COLOR_ROLES) {
    const v = parsed.colors?.[key];
    if (typeof v === 'string' && evidenceColors.has(v.trim().toLowerCase())) {
      brand.colors[key] = v.trim();
    }
  }
  if (Object.keys(brand.colors).length > 0) brand.confidence.colors = 0.6;

  const evidenceFonts = new Set(evidence.fontFamilies.map((f) => f.toLowerCase()));
  const heading = parsed.typography?.headingFont;
  const body = parsed.typography?.bodyFont;
  if (typeof heading === 'string' && evidenceFonts.has(heading.trim().toLowerCase())) brand.typography.headingFont = heading.trim();
  if (typeof body === 'string' && evidenceFonts.has(body.trim().toLowerCase())) brand.typography.bodyFont = body.trim();
  if (Object.keys(brand.typography).length > 0) brand.confidence.typography = 0.65;

  // If the AI produced no usable colors or fonts, fall back to the pure evidence
  // mapping (which still derives primary from theme-color) — never worse than skipped.
  // Checked before the logo backfill: the logo is heuristic, not an AI contribution.
  const aiContributed = Object.keys(brand.colors).length > 0 || Object.keys(brand.typography).length > 0;
  if (!aiContributed) return evidenceToExtractedBrand(evidence, url);

  // Logo isn't AI-inferred — take the top heuristic candidate.
  if (evidence.logoCandidates[0]) {
    brand.logoUrl = evidence.logoCandidates[0];
    brand.confidence.logo = 0.5;
  }

  return ExtractedBrandSchema.parse(brand);
}

/** Heuristic engine: fetch → collect evidence → AI-normalize (best effort) → ExtractedBrand. */
async function extractViaHeuristic(url: string): Promise<ExtractedBrand> {
  const html = await fetchPageHtml(url);
  const evidence = collectBrandEvidence(html, url);
  const credentials = await resolveAiKeys();
  if (!credentials) return evidenceToExtractedBrand(evidence, url);
  try {
    const { system, user } = buildNormalizePrompt(evidence);
    const text = await callAiJson(system, user, credentials);
    return parseNormalizedBrand(text, evidence, url);
  } catch {
    return evidenceToExtractedBrand(evidence, url);
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Extract a reviewable brand draft from a URL. Firecrawl when a key resolves
 * (vault BYOK or owner env), heuristic otherwise; Firecrawl failure falls
 * through to heuristic; heuristic failure returns an empty-but-valid draft.
 * Never throws for a reachable-but-unhelpful page — extraction must not block.
 */
export async function extractBrandFromUrl(url: string): Promise<ExtractedBrand> {
  // The whole body is guarded — even the vault/env secret lookup can reject (DB/decrypt error),
  // and the contract is that extraction never throws (it degrades to an empty-but-valid draft).
  let firecrawlKey: string | null = null;
  try {
    firecrawlKey = await resolveSecret('firecrawl_api_key');
    if (firecrawlKey) {
      try {
        const payload = await fetchFirecrawlBranding(url, firecrawlKey);
        return mapFirecrawlBranding(payload, url);
      } catch {
        // Fall through to the heuristic engine.
      }
    }
    return await extractViaHeuristic(url);
  } catch {
    return emptyExtractedBrand(url, firecrawlKey ? 'firecrawl' : 'heuristic');
  }
}

// ── Merge into generation intake / provenance ────────────────────────────────

/**
 * StyleGuide `meta.source` implied by an extraction engine (Amendment F provenance).
 * Returns undefined (→ caller keeps 'manual') when the extraction yielded no brand
 * evidence, so a failed/empty extraction is never mislabeled as URL-sourced.
 */
export function sourceFromExtraction(
  extracted?: Pick<ExtractedBrand, 'engine' | 'colors' | 'typography' | 'logoUrl'>
): StyleGuide['meta']['source'] | undefined {
  if (!extracted) return undefined;
  const hasContent =
    Object.keys(extracted.colors ?? {}).length > 0 ||
    Object.keys(extracted.typography ?? {}).length > 0 ||
    !!extracted.logoUrl;
  if (!hasContent) return undefined;
  return extracted.engine === 'firecrawl' ? 'firecrawl-url' : 'reference-url';
}

/**
 * Fold an ExtractedBrand into a generation intake as high-priority evidence:
 * extracted colors/fonts/logo are woven into `colorPreferences` and
 * `existingBrandNotes` so `generateStyleGuideFromIntake` honors them, while the
 * generator still fills whatever extraction couldn't. Pure — the user's own
 * typed answers are preserved and the extracted evidence is appended, never
 * silently replacing them.
 */
export function mergeExtractedBrand(intake: DesignIntakeInput, extracted: ExtractedBrand): DesignIntakeInput {
  const colorBits: string[] = [];
  for (const [role, value] of Object.entries(extracted.colors)) {
    if (value) colorBits.push(`${role}: ${value}`);
  }
  const colorPreferences = [intake.colorPreferences, colorBits.length ? `Extracted brand colors — ${colorBits.join(', ')}` : '']
    .filter(Boolean)
    .join('. ')
    .trim() || undefined;

  const noteBits: string[] = [];
  if (extracted.typography.headingFont) noteBits.push(`Heading font: ${extracted.typography.headingFont}`);
  if (extracted.typography.bodyFont) noteBits.push(`Body font: ${extracted.typography.bodyFont}`);
  if (extracted.logoUrl) noteBits.push(`Logo: ${extracted.logoUrl}`);
  const existingBrandNotes = [intake.existingBrandNotes, noteBits.length ? `Extracted from ${extracted.sourceUrl} — ${noteBits.join('; ')}` : '']
    .filter(Boolean)
    .join('\n')
    .trim() || undefined;

  return { ...intake, colorPreferences, existingBrandNotes };
}

/**
 * Build a `validateStyleGuideChange`-compatible deep-partial patch from an
 * ExtractedBrand — the payload the Site Theme "Extract from URL" action applies
 * (through the existing PATCH /design path, so only whitelisted token fields can
 * land and nothing is silently overwritten). Logo has no StyleGuide token, so it
 * is intentionally excluded.
 */
export function extractedBrandToStyleGuidePatch(extracted: ExtractedBrand): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const colors = Object.fromEntries(Object.entries(extracted.colors).filter(([, v]) => v));
  if (Object.keys(colors).length) patch.colors = colors;

  const typography = Object.fromEntries(Object.entries(extracted.typography).filter(([, v]) => v));
  if (Object.keys(typography).length) patch.typography = typography;

  if (extracted.radii.md) patch.radii = { md: extracted.radii.md };
  if (extracted.shadows.md) patch.shadows = { md: extracted.shadows.md };

  return patch;
}
