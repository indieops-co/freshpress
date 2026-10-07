import { buildDefaultStyleGuide, generateCssVariables, StyleGuideSchema, type StyleGuide } from './style-guide.js';
import { resolveAiKeys } from '../integrations/resolve.js';
import { callAiJson, extractJsonValue } from '../ai/call-json.js';
import { DESIGN_RULES_MAX_CHARS, truncateAtLineBoundary } from './design-excellence.js';

const HEX_RE = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
// Targets the YAML `fontFamily:` key used throughout awesome-design-md's typography
// scale entries (e.g. `fontFamily: "Copernicus, Tiempos Headline, serif"` or
// `fontFamily: Geist, Inter, system-ui, sans-serif`). Deliberately does NOT match
// loose prose mentions of the word "Font" (e.g. "### Font Family", "### Note on
// Font Substitutes" markdown headings) — those have a space between "Font" and the
// next word, never a colon directly touching "font", so they never match here.
const FONT_FAMILY_RE = /fontFamily:\s*(?:"([^"]+)"|'([^']+)'|([^\n"']+))/g;

function extractHexColors(raw: string): string[] {
  const matches = raw.match(HEX_RE) ?? [];
  return [...new Set(matches.map((h) => h.toLowerCase()))];
}

/** Relative luminance (0 = black, 1 = white) of a #rgb/#rrggbb hex. */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ordered, de-duplicated font-stack first-names, with monospace stacks identified. */
function extractFonts(raw: string): { fonts: string[]; mono?: string } {
  const values: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FONT_FAMILY_RE.source, 'g');
  while ((m = re.exec(raw)) !== null) {
    const rawValue = m[1] ?? m[2] ?? m[3] ?? '';
    const name = rawValue.split(',')[0].trim().replace(/['"]/g, '');
    if (name.length > 1 && !values.includes(name)) values.push(name);
  }
  const mono = values.find((v) => /mono/i.test(v));
  const fonts = values.filter((v) => v !== mono);
  return { fonts, mono };
}

// The guardrail prose sections worth carrying into generation prompts, in
// priority order. Vendored files use plain `## Do's and Don'ts`; generated
// DESIGN.md uses numbered `## 7. Do's and Don'ts`; apostrophes may be curly.
const RULE_SECTION_HEADINGS = [
  /^##\s*(?:\d+\.\s*)?do['’`]?s\s+and\s+don['’`]?ts\b.*$/im,
  /^##\s*(?:\d+\.\s*)?agent\s+prompt\s+guide\b.*$/im,
  /^##\s*(?:\d+\.\s*)?visual\s+theme\b.*$/im,
];

/** The named section including its heading, up to the next `## ` heading or EOF. */
function sliceSection(rawMd: string, heading: RegExp): string {
  const m = heading.exec(rawMd);
  if (!m) return '';
  const next = rawMd.indexOf('\n## ', m.index + m[0].length);
  return (next === -1 ? rawMd.slice(m.index) : rawMd.slice(m.index, next)).trim();
}

// designRules flows into generation prompts and remote DESIGN.md files are
// semi-trusted, so strip markup/control chars; token refs like `{colors.primary}`
// stay — they're meaningful to the models reading the rules. The tag pattern
// requires a tag-like start and no newline inside, so a bare comparison in a
// guardrail ("below < 14px" … "keep > 45ch") never gets swallowed as markup.
function sanitizeRules(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Deterministically extract a DESIGN.md's own guardrail prose (Do's and
 * Don'ts, then Agent Prompt Guide, then Visual Theme) for
 * StyleGuide.designRules, capped at a line boundary. Operates on the FULL
 * raw markdown — these sections sit at the end of real awesome-design-md
 * files, past the 12k-char slice the AI parse pass reads, so extraction here
 * is the only reliable carry-through. Never AI-derived (see the deliberate
 * override in parseDesignMd below).
 */
export function extractDesignRules(rawMd: string, maxChars = DESIGN_RULES_MAX_CHARS): string {
  const sections = RULE_SECTION_HEADINGS
    .map((heading) => sanitizeRules(sliceSection(rawMd, heading)))
    .filter(Boolean);
  return truncateAtLineBoundary(sections.join('\n\n'), maxChars);
}

const FONT_SUBSTITUTES_HEADING = /^###\s*note\s+on\s+font\s+substitutes?\b.*$/im;

/**
 * The source DESIGN.md's "Note on Font Substitutes" body — the file's own
 * licensed-face → public-substitute mapping, carried into export docs
 * (WordPress THEME-NOTES.md) so substitutions are honored per NOTICE.md.
 * Returns '' when the file documents none. `###`-level, so sliceSection
 * (which cuts at `## `) doesn't apply; the section ends at the next heading
 * of depth 1–3 (h4+ subsections stay part of the note).
 */
export function extractFontSubstitutesNote(rawMd: string): string {
  const m = FONT_SUBSTITUTES_HEADING.exec(rawMd);
  if (!m) return '';
  const rest = rawMd.slice(m.index + m[0].length);
  const next = rest.search(/\n#{1,3}\s/);
  return sanitizeRules(next === -1 ? rest : rest.slice(0, next));
}

/** Heuristic parser — no AI required */
export function parseDesignMdHeuristic(
  rawMd: string,
  themeId: string,
  themeName: string,
  aesthetic: string
): StyleGuide {
  const guide = buildDefaultStyleGuide(themeId, themeName, aesthetic);
  const colors = extractHexColors(rawMd);
  const { fonts, mono } = extractFonts(rawMd);

  if (colors[0]) guide.colors.primary = colors[0];
  if (colors[1]) guide.colors.secondary = colors[1];
  if (colors[2]) guide.colors.accent = colors[2];
  if (colors[3]) guide.colors.background = colors[3];
  if (colors[4]) guide.colors.surface = colors[4];
  if (colors[5]) guide.colors.text = colors[5];

  if (fonts[0]) guide.typography.headingFont = fonts[0];
  if (fonts[1]) guide.typography.bodyFont = fonts[1];
  else if (fonts[0]) guide.typography.bodyFont = fonts[0];
  if (mono) guide.typography.monoFont = mono;

  // Rescue sparse dark-theme files whose background hex wasn't extracted —
  // but only when the background is still the untouched default.
  if (guide.colors.background === '#ffffff' && rawMd.toLowerCase().includes('dark')) {
    guide.colors.background = '#0a0a0a';
  }

  // Readability is decided by the ACTUAL background's luminance, never by
  // whether the file mentions "dark" somewhere (every corpus file does — the
  // old check forced near-white text onto light-canvas themes like Shopify's
  // cream pages, producing invisible text on the no-AI fallback path).
  const bgLuminance = hexLuminance(guide.colors.background);
  if (Math.abs(bgLuminance - hexLuminance(guide.colors.text)) < 0.35) {
    guide.colors.text = bgLuminance < 0.5 ? '#f5f5f5' : '#171717';
  }
  if (bgLuminance < 0.4 && hexLuminance(guide.colors.surface) > 0.6) {
    guide.colors.surface = '#1a1a1a';
  }

  guide.aiSystemPromptAddition = `Design direction: ${themeName} (${aesthetic}). Primary ${guide.colors.primary}, accent ${guide.colors.accent}. Fonts: ${guide.typography.headingFont} headings, ${guide.typography.bodyFont} body.`;
  guide.designRules = extractDesignRules(rawMd);
  guide.cssVariables = generateCssVariables(guide);
  return StyleGuideSchema.parse(guide);
}

export async function parseDesignMd(
  rawMd: string,
  themeId: string,
  themeName: string,
  aesthetic: string
): Promise<StyleGuide> {
  const heuristic = parseDesignMdHeuristic(rawMd, themeId, themeName, aesthetic);
  const ai = await resolveAiKeys();
  if (!ai) return heuristic;

  try {
    const systemPrompt = `You are a design system parser. Given DESIGN.md content, return ONLY valid JSON matching this schema fields: meta (keep id/name/source/sourceRef/aesthetic/designPhilosophy/createdAt), colors, typography, spacing, radii, shadows, components, motion, aiSystemPromptAddition, tailwindExtension (object), cssVariables (string). Use hex colors. Fill all fields.`;
    const userContent = `Theme: ${themeName}\n\n${rawMd.slice(0, 12000)}`;

    const text = await callAiJson(systemPrompt, userContent, ai, { maxTokens: 4096 });

    const value = extractJsonValue(text, 'object');
    if (!value || typeof value !== 'object') return heuristic;

    const parsed = value as StyleGuide;
    parsed.meta = {
      ...heuristic.meta,
      ...parsed.meta,
      id: heuristic.meta.id,
      source: 'awesome-design-md',
      sourceRef: themeId,
      createdAt: heuristic.meta.createdAt,
    };
    // Always the deterministic extraction (already computed by the heuristic),
    // overriding anything the AI returned: the model only sees the first 12k
    // chars (rules sections sit past that in real files), and prompt-bound
    // prose must stay deterministic, not AI-authored.
    parsed.designRules = heuristic.designRules;
    if (!parsed.cssVariables) parsed.cssVariables = generateCssVariables(parsed);
    return StyleGuideSchema.parse(parsed);
  } catch {
    return heuristic;
  }
}
