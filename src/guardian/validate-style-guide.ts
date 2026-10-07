/**
 * The Site Theme page's Guardian (Chunk 5 / Amendment E). Validates a proposed
 * change to the site-wide `StyleGuide` — from either the structured JSON/code panel
 * or the `elementType`-scoped chat box — against a whitelist of editable token fields.
 * Both surfaces funnel through `validateStyleGuideChange`, so they cannot drift apart.
 *
 * This is the site-wide, type-level counterpart to Chunk 3's per-element
 * `validateElementStyleChanges` (which edits one `NamedElement.styleOverrides`
 * instance). Here we edit the tokens themselves, so values are free-form CSS
 * (injection-checked) rather than token-name references.
 *
 * Deterministic, dependency-free, no AI — unit-testable in isolation.
 */
import {
  StyleGuideSchema,
  generateCssVariables,
  type StyleGuide,
} from '../design/style-guide.js';

/** How a given StyleGuide leaf field is validated. */
export type EditableKind =
  | { kind: 'css-value' } // single injection-safe CSS value (lengths, radii, durations)
  | { kind: 'color' } // css color-ish value (hex/rgb/hsl/var), injection-safe
  | { kind: 'shadow' } // multi-part box-shadow / border shorthand, injection-safe
  | { kind: 'font' } // font-family string
  | { kind: 'text'; max: number } // descriptive free string (no markup)
  | { kind: 'number' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'site-css' }; // site-wide raw CSS ruleset (selectors/braces allowed; JS/exfil blocked)

const COLOR_FIELDS = [
  'primary',
  'secondary',
  'accent',
  'background',
  'surface',
  'surfaceStrong',
  'text',
  'textMuted',
  'textInverse',
  'border',
  'success',
  'warning',
  'error',
] as const;

const TYPE_SCALE_TOKENS = [
  'displayLg',
  'displayMd',
  'h1',
  'h2',
  'h3',
  'h4',
  'bodyLg',
  'body',
  'bodySm',
  'caption',
  'label',
] as const;

/**
 * The complete whitelist of editable StyleGuide leaf paths → how each is validated.
 * Anything NOT listed here (meta.id/source/createdAt, cssVariables, tailwindExtension,
 * aiSystemPromptAddition, designRules) is rejected — those are identity/derived/
 * prompt-injection-sensitive fields the panel and chat must never write. designRules
 * in particular flows into generation prompts, so it is derived only from the source
 * DESIGN.md (extractDesignRules), never from a PATCH.
 */
export const EDITABLE_PATHS: Record<string, EditableKind> = (() => {
  const paths: Record<string, EditableKind> = {
    'meta.name': { kind: 'text', max: 120 },

    'typography.headingFont': { kind: 'font' },
    'typography.bodyFont': { kind: 'font' },
    'typography.monoFont': { kind: 'font' },

    'spacing.xs': { kind: 'css-value' },
    'spacing.sm': { kind: 'css-value' },
    'spacing.md': { kind: 'css-value' },
    'spacing.lg': { kind: 'css-value' },
    'spacing.xl': { kind: 'css-value' },
    'spacing.section': { kind: 'css-value' },
    'spacing.container': { kind: 'css-value' },
    'spacing.gutter': { kind: 'css-value' },

    'radii.none': { kind: 'css-value' },
    'radii.sm': { kind: 'css-value' },
    'radii.md': { kind: 'css-value' },
    'radii.lg': { kind: 'css-value' },
    'radii.xl': { kind: 'css-value' },
    'radii.pill': { kind: 'css-value' },
    'radii.full': { kind: 'css-value' },

    'shadows.sm': { kind: 'shadow' },
    'shadows.md': { kind: 'shadow' },
    'shadows.lg': { kind: 'shadow' },
    'shadows.glow': { kind: 'shadow' },

    'components.button.primaryBg': { kind: 'color' },
    'components.button.primaryText': { kind: 'color' },
    'components.button.primaryRadius': { kind: 'css-value' },
    'components.button.primaryPadding': { kind: 'css-value' },
    'components.button.secondaryStyle': { kind: 'enum', values: ['outline', 'ghost', 'soft'] },
    'components.button.ctaStyle': { kind: 'text', max: 200 },

    'components.card.background': { kind: 'color' },
    'components.card.border': { kind: 'shadow' },
    'components.card.radius': { kind: 'css-value' },
    'components.card.shadow': { kind: 'shadow' },
    'components.card.padding': { kind: 'css-value' },

    'components.nav.style': { kind: 'enum', values: ['floating', 'sticky', 'static', 'full-width'] },
    'components.nav.background': { kind: 'color' },
    'components.nav.textColor': { kind: 'color' },
    'components.nav.ctaStyle': { kind: 'text', max: 200 },

    'components.hero.layout': { kind: 'enum', values: ['centered', 'split-left', 'split-right', 'full-bleed'] },
    'components.hero.headlineTreatment': { kind: 'text', max: 200 },
    'components.hero.ctaCount': { kind: 'number' },

    'components.footer.background': { kind: 'color' },
    'components.footer.style': { kind: 'enum', values: ['minimal', 'full', 'dark-band'] },

    'motion.style': { kind: 'enum', values: ['none', 'subtle', 'expressive'] },
    'motion.defaultDuration': { kind: 'css-value' },
    'motion.defaultEasing': { kind: 'css-value' },
    'motion.pageLoad': { kind: 'text', max: 200 },

    customCss: { kind: 'site-css' },
  };

  for (const field of COLOR_FIELDS) {
    paths[`colors.${field}`] = { kind: 'color' };
  }
  for (const token of TYPE_SCALE_TOKENS) {
    paths[`typography.scale.${token}.size`] = { kind: 'css-value' };
    paths[`typography.scale.${token}.weight`] = { kind: 'css-value' };
    paths[`typography.scale.${token}.lineHeight`] = { kind: 'css-value' };
    paths[`typography.scale.${token}.tracking`] = { kind: 'css-value' };
    paths[`typography.scale.${token}.transform`] = { kind: 'css-value' };
  }

  return paths;
})();

/** Resolve the validation kind for a leaf path, including dynamic `colors.custom.*` entries. */
export function editableKindForPath(path: string): EditableKind | undefined {
  if (path.startsWith('colors.custom.')) {
    // custom.<key> — any user-defined color token. Reject a nested/empty key.
    const key = path.slice('colors.custom.'.length);
    return key.length > 0 && !key.includes('.') ? { kind: 'color' } : undefined;
  }
  return EDITABLE_PATHS[path];
}

/**
 * Layout/growth token groups that stay editable under ANY element scope, so a scoped
 * edit is never boxed in: a container can grow to respect its gutters and a text block
 * can gain size/leading/tracking without the parent squeezing it (David's Q3 answer —
 * "don't leave a card SQUEEZED because the scope didn't include its parent").
 */
const GROWTH_PREFIXES = ['spacing', 'radii', 'shadows', 'typography.scale'] as const;

/**
 * Map an `elementType` (specimen label / taxonomy type) to the StyleGuide path prefixes
 * a scoped edit may touch. Returns `null` for global/unknown types (colors, "Page",
 * anything unmatched) meaning "no scope restriction — the whole editable whitelist".
 * Known types return their core token group unioned with the always-allowed growth groups.
 */
export function allowedPathsForElementType(elementType: string): string[] | null {
  const t = elementType.toLowerCase();
  const core = coreScopePrefixes(t);
  if (core === null) return null;
  return [...new Set([...core, ...GROWTH_PREFIXES])];
}

function coreScopePrefixes(t: string): string[] | null {
  // Order matters: more-specific keywords are checked before broader ones, so compound labels
  // like "PricingTable" (→ table/growth) and "CardHeader" (→ card) don't get hijacked by "header"/"pricing".
  if (/\b(color|palette|page|global|theme)\b/.test(t) || t === '') return null;
  if (t.includes('button') || t.includes('cta') || t.includes('btn')) return ['components.button'];
  if (t.includes('footer')) return ['components.footer'];
  if (t.includes('hero')) return ['components.hero'];
  // Layout containers with no component token of their own — rely on the growth groups only.
  if (
    t.includes('section') ||
    t.includes('grid') ||
    t.includes('gallery') ||
    t.includes('form') ||
    t.includes('table') ||
    t.includes('sidebar')
  ) {
    return [];
  }
  if (t.includes('card') || t.includes('faqitem') || t.includes('testimonial') || t.includes('pricing')) {
    return ['components.card'];
  }
  if (
    t.includes('title') ||
    t.includes('heading') ||
    /\bh[1-6]\b/.test(t) ||
    t.includes('display') ||
    t.includes('caption') ||
    t.includes('label') ||
    t.includes('body') ||
    t.includes('text') ||
    t.includes('type')
  ) {
    return ['typography'];
  }
  if (t.includes('nav') || t.includes('header') || t.includes('menu')) return ['components.nav'];
  // Unknown/discovered type — don't guess a restriction; allow the full whitelist.
  return null;
}

function isPathAllowed(path: string, allowedPrefixes: string[]): boolean {
  return allowedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
}

/** Read the current value at a dotted leaf path (undefined if absent). */
function valueAtPath(guide: StyleGuide, path: string): unknown {
  let node: unknown = guide;
  for (const key of path.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

export interface EditableFieldInfo {
  path: string;
  kind: EditableKind;
  current: unknown;
}

/**
 * The editable fields visible under a given scope (all of them when unscoped), each with its
 * current value and validation kind. Shared by the AI chat prompt and — via the API — the
 * structured panel, so both surfaces describe exactly the same whitelist.
 */
export function editableSurfaceForScope(
  guide: StyleGuide,
  elementType?: string
): EditableFieldInfo[] {
  const allowedPrefixes = elementType ? allowedPathsForElementType(elementType) : null;
  const custom = Object.keys(guide.colors.custom).map((k) => `colors.custom.${k}`);
  const allPaths = [...Object.keys(EDITABLE_PATHS), ...custom];
  const fields: EditableFieldInfo[] = [];
  for (const path of allPaths) {
    if (allowedPrefixes && !isPathAllowed(path, allowedPrefixes)) continue;
    const kind = editableKindForPath(path);
    if (!kind) continue;
    fields.push({ path, kind, current: valueAtPath(guide, path) });
  }
  return fields;
}

/**
 * Single CSS value must be injection-safe: no selectors, braces, at-rules, urls, or script triggers.
 * Backslash is banned too — a CSS unicode escape (e.g. `\75 rl(` → `url(`) would otherwise reconstitute
 * a blocked construct past this regex once the browser un-escapes it.
 */
const CSS_VALUE_FORBIDDEN = /[{}<>;@\\]|\/\*|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript:/i;
/** Descriptive text (meta.name, ctaStyle, …) is not CSS — only block HTML/script vectors, allow @ and punctuation. */
const TEXT_FORBIDDEN = /[<>]|javascript:/i;

/**
 * Site-wide raw CSS (a full ruleset, not a single value) — selectors, braces, @media/@font-face
 * are fine, but the exfiltration / breakout / script vectors are not. Exported so the client can
 * mirror the check for instant feedback; the server remains authoritative.
 */
const SITE_CSS_FORBIDDEN = /<\/|<script|javascript:|expression\s*\(|behavior\s*:|-moz-binding|@import\b/i;
const SITE_CSS_MAX = 20000;

export function validateSiteCustomCss(css: string): string[] {
  const errors: string[] = [];
  if (typeof css !== 'string') return ['Site custom CSS must be a string'];
  if (css.length > SITE_CSS_MAX) errors.push(`Site custom CSS exceeds ${SITE_CSS_MAX} characters`);
  if (SITE_CSS_FORBIDDEN.test(css)) {
    errors.push(
      'Site custom CSS contains disallowed syntax — @import, <script>, javascript:, expression(), behavior, and -moz-binding are not permitted'
    );
  }
  // Balanced-brace guard (defense-in-depth; the real <style> breakout is already blocked by <\/ above).
  // Strip comments and quoted strings first so braces inside content:'}' or /* } */ aren't miscounted.
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) errors.push('Site custom CSS has unbalanced { } braces');
  return errors;
}

function validateValue(kind: EditableKind, path: string, value: unknown): string | null {
  switch (kind.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `Field "${path}" must be a number`;
      }
      return null;
    case 'enum':
      if (typeof value !== 'string' || !kind.values.includes(value)) {
        return `Field "${path}" must be one of: ${kind.values.join(', ')}`;
      }
      return null;
    case 'text':
      if (typeof value !== 'string') return `Field "${path}" must be a string`;
      if (value.length > kind.max) return `Field "${path}" exceeds ${kind.max} characters`;
      if (TEXT_FORBIDDEN.test(value)) return `Field "${path}" contains disallowed markup`;
      return null;
    case 'font':
      if (typeof value !== 'string' || !value.trim()) return `Field "${path}" must be a non-empty string`;
      if (value.length > 200) return `Field "${path}" is too long`;
      if (TEXT_FORBIDDEN.test(value) || /[;{}@\\]|url\s*\(/i.test(value)) {
        return `Field "${path}" contains disallowed characters`;
      }
      return null;
    case 'site-css': {
      if (typeof value !== 'string') return `Field "${path}" must be a string`;
      const cssErrors = validateSiteCustomCss(value);
      return cssErrors.length ? `Field "${path}": ${cssErrors[0]}` : null;
    }
    case 'color':
    case 'css-value':
    case 'shadow': {
      if (typeof value !== 'string' || !value.trim()) return `Field "${path}" must be a non-empty CSS value`;
      const max = kind.kind === 'shadow' ? 400 : 200;
      if (value.length > max) return `Field "${path}" is too long`;
      if (CSS_VALUE_FORBIDDEN.test(value)) {
        return `Field "${path}" contains disallowed CSS syntax (selectors, braces, @rules, url(), or script triggers)`;
      }
      return null;
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Flatten a nested patch into [dottedPath, leafValue] pairs. */
function flattenPatch(patch: Record<string, unknown>, prefix = ''): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      out.push(...flattenPatch(value, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

/** Deep-merge `patch` onto `base`, producing a new object (base untouched). */
function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export interface StyleGuideGuardianResult {
  ok: boolean;
  errors: string[];
  /** The full, re-validated StyleGuide with the patch applied and cssVariables regenerated. */
  applied?: StyleGuide;
}

/**
 * Validate and apply a partial change to a site's StyleGuide.
 *
 * @param current The site's active StyleGuide.
 * @param patch   A deep-partial of StyleGuide — only the leaf fields being changed.
 * @param scope   Optional `{ elementType }`; when present, confines the patch to that
 *                type's token group (plus always-allowed layout/growth groups). Omit
 *                (or clear the scope pill) to edit the whole guide.
 */
export function validateStyleGuideChange(
  current: StyleGuide,
  patch: unknown,
  scope?: { elementType?: string }
): StyleGuideGuardianResult {
  if (!isPlainObject(patch)) {
    return { ok: false, errors: ['patch must be an object of StyleGuide fields to change'] };
  }

  const flat = flattenPatch(patch);
  if (flat.length === 0) {
    return { ok: false, errors: ['patch contains no editable fields'] };
  }

  const allowedPrefixes = scope?.elementType ? allowedPathsForElementType(scope.elementType) : null;
  const errors: string[] = [];

  for (const [path, value] of flat) {
    const kind = editableKindForPath(path);
    if (!kind) {
      errors.push(`Field "${path}" is not editable via the Site Theme page`);
      continue;
    }
    if (allowedPrefixes && !isPathAllowed(path, allowedPrefixes)) {
      errors.push(
        `Field "${path}" is outside the current selection (${scope!.elementType}) — clear the selection to edit it site-wide`
      );
      continue;
    }
    const valueError = validateValue(kind, path, value);
    if (valueError) errors.push(valueError);
  }

  if (errors.length > 0) return { ok: false, errors };

  const merged = deepMerge(current, patch);
  const reparsed = StyleGuideSchema.safeParse(merged);
  if (!reparsed.success) {
    return { ok: false, errors: reparsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) };
  }

  const applied = reparsed.data;
  applied.cssVariables = generateCssVariables(applied);
  return { ok: true, errors: [], applied };
}
