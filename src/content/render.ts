import type { NamedElement, PageContent, ContentSlot } from './types.js';
import { slotPlaceholder } from './types.js';
import { generateStyleSheet, styleTokenMaps, escapeStyleBreakout, type StyleGuide } from '../design/style-guide.js';
import { injectElementIds } from './containers.js';

/**
 * Render frozen template + slot values into final HTML. Container wrappers are stamped with
 * data-element-id first (Chunk 4 — the hook the sidebar/click-highlight and element overrides
 * below both rely on). When a StyleGuide is provided, its generated stylesheet is injected and
 * the page root is tagged with .fp-page so theme rules apply — same path for preview and publish.
 * Per-element style/customCss overrides (Chunk 3's Guardian-validated NamedElement data) render
 * last, after the theme sheet, so they win on specificity ties.
 */
export function renderPage(content: PageContent, styleGuide?: StyleGuide): string {
  let html = content.containers ? injectElementIds(content.template, content.containers) : content.template;

  for (const [id, slot] of Object.entries(content.slots)) {
    const placeholder = slotPlaceholder(id);
    const rendered = renderSlot(slot);
    html = html.split(placeholder).join(rendered);
  }

  if (styleGuide) {
    html = wrapPageForTheme(html);
  }

  // Built as one array and inserted in a single insertIntoHead call, not two sequential ones —
  // a fragment template (no </head>) falls back to prepending, and two independent prepends
  // would land in reverse order, putting overrides before the theme sheet they need to win a
  // specificity tie against.
  const styleTags: string[] = [];
  if (styleGuide) {
    styleTags.push(`<style data-fp-theme>\n${generateStyleSheet(styleGuide)}\n</style>`);
  }
  if (content.namedElements) {
    const overridesCss = generateElementOverrides(content.namedElements, styleGuide);
    if (overridesCss) {
      styleTags.push(`<style data-fp-element-overrides>\n${overridesCss}\n</style>`);
    }
  }
  if (styleTags.length > 0) {
    html = insertIntoHead(html, styleTags.join('\n'));
  }

  return html;
}

/** Scope the document under .fp-page: class added to <body>, or fragments wrapped in a div. */
function wrapPageForTheme(html: string): string {
  const bodyMatch = html.match(/<body([^>]*)>/i);
  if (bodyMatch) {
    const attrs = bodyMatch[1];
    const replaced = /class\s*=\s*(["'])/i.test(attrs)
      ? `<body${attrs.replace(/class\s*=\s*(["'])/i, 'class=$1fp-page ')}>`
      : `<body${attrs} class="fp-page">`;
    return html.replace(bodyMatch[0], replaced);
  }
  return `<div class="fp-page">\n${html}\n</div>`;
}

/**
 * Inject a theme <style> block and scope the document under .fp-page.
 * Works on full documents (into <head>, class on <body>) and fragments
 * (style prepended, fragment wrapped in a .fp-page div).
 */
export function injectStyleGuide(html: string, guide: StyleGuide): string {
  const styleTag = `<style data-fp-theme>\n${generateStyleSheet(guide)}\n</style>`;
  return insertIntoHead(wrapPageForTheme(html), styleTag);
}

/** Insert a <style>/tag into <head> if present, else prepend it (fragments have no <head>). */
function insertIntoHead(html: string, tag: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tag}\n</head>`);
  }
  return `${tag}\n${html}`;
}

/** Amendment A: per-element style-property + StyleGuide-property CSS name pairing (never the token category name itself). */
const CSS_PROPERTY_NAMES: Record<keyof NonNullable<NamedElement['styleOverrides']>, string> = {
  padding: 'padding',
  margin: 'margin',
  radius: 'border-radius',
  shadow: 'box-shadow',
  background: 'background-color',
  textColor: 'color',
};

/**
 * Amendment A: compile every NamedElement's Guardian-validated styleOverrides (token refs,
 * resolved through the StyleGuide) and raw customCss into `[data-element-id="X"] { … }` rules.
 * Structured overrides are silently skipped without a StyleGuide (nothing to resolve tokens
 * against) — customCss still applies since it never depended on one.
 */
export function generateElementOverrides(
  namedElements: Record<string, NamedElement>,
  styleGuide?: StyleGuide
): string {
  const tokenMaps = styleGuide ? styleTokenMaps(styleGuide) : undefined;
  const rules: string[] = [];

  for (const el of Object.values(namedElements)) {
    const declarations: string[] = [];

    if (el.styleOverrides && tokenMaps) {
      for (const [prop, tokenName] of Object.entries(el.styleOverrides) as [
        keyof NonNullable<NamedElement['styleOverrides']>,
        string,
      ][]) {
        const value = tokenMaps[prop]?.[tokenName];
        if (value !== undefined) declarations.push(`${CSS_PROPERTY_NAMES[prop]}: ${value};`);
      }
    }

    if (el.customCss) {
      declarations.push(el.customCss.trim());
    }

    if (declarations.length > 0) {
      rules.push(`[data-element-id="${el.id}"] { ${declarations.join(' ')} }`);
    }
  }

  // customCss reaches a raw <style> block here (and in the WP export), so it goes
  // through the same breakout choke point as the theme sheet — Guardian validation
  // upstream is the gate, this is the belt.
  return escapeStyleBreakout(rules.join('\n'));
}

function renderSlot(slot: ContentSlot): string {
  switch (slot.type) {
    case 'image':
      return `<img src="${escapeAttr(slot.value)}" alt="${escapeAttr(slot.alt ?? '')}" data-slot-id="${escapeAttr(slot.id)}" />`;
    case 'link':
      return `<a href="${escapeAttr(slot.href ?? '#')}" data-slot-id="${escapeAttr(slot.id)}">${escapeHtml(slot.value)}</a>`;
    case 'button':
      return `<button type="button" data-slot-id="${escapeAttr(slot.id)}">${escapeHtml(slot.value)}</button>`;
    case 'text':
    default:
      return escapeHtml(slot.value);
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

/** Apply validated slot updates immutably */
export function applySlotChanges(
  content: PageContent,
  changes: Record<string, Partial<Pick<ContentSlot, 'value' | 'href' | 'alt'>>>
): PageContent {
  const slots = { ...content.slots };

  for (const [slotId, patch] of Object.entries(changes)) {
    const existing = slots[slotId];
    if (!existing) continue;
    slots[slotId] = { ...existing, ...patch };
  }

  return { ...content, slots };
}
