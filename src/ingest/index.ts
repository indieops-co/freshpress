import * as cheerio from 'cheerio';
import type { Element, AnyNode } from 'domhandler';
import type { ContentSlot, IngestResult, PageContent, SlotType } from '../content/types.js';
import { slotPlaceholder } from '../content/types.js';

const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'li', 'td', 'th', 'label', 'figcaption', 'blockquote', 'strong', 'em', 'small']);
const LINK_TAGS = new Set(['a']);
const BUTTON_TAGS = new Set(['button', 'input']);
const IMAGE_TAGS = new Set(['img']);

interface SlotCandidate {
  id: string;
  type: SlotType;
  value: string;
  href?: string;
  alt?: string;
  tag: string;
  path: string;
  element: Element;
}

/** Fetch and parse a URL into a frozen template + content slots */
export async function ingestUrl(sourceUrl: string): Promise<IngestResult> {
  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'FreshPress-Ingest/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return ingestHtml(sourceUrl, html);
}

/** Parse raw HTML into frozen template + content slots */
export function ingestHtml(sourceUrl: string, html: string): IngestResult {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || 'Untitled';
  const candidates: SlotCandidate[] = [];

  $('body *').each(function (this: Element) {
    const el = this;
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;

    const path = buildElementPath($, el);
    const type = classifyElement($, el, tag);
    if (!type) return;

    const candidate = extractCandidate($, el, tag, type, path);
    if (candidate) candidates.push(candidate);
  });

  // Deduplicate: for text elements, only slot leaf nodes (direct text, no nested slot children)
  const filtered = filterLeafSlots(candidates);

  const slots: Record<string, ContentSlot> = {};
  const slotOrder: string[] = [];

  for (const c of filtered) {
    slots[c.id] = {
      id: c.id,
      type: c.type,
      value: c.value,
      href: c.href,
      alt: c.alt,
      tag: c.tag,
      path: c.path,
    };
    slotOrder.push(c.id);

    replaceElementWithPlaceholder($, c.element, c.id, c.type);
  }

  const template = $.html();
  const pagePath = new URL(sourceUrl).pathname || '/';

  return {
    sourceUrl,
    pagePath,
    title,
    content: { template, slots, slotOrder },
  };
}

function classifyElement($: cheerio.CheerioAPI, el: Element, tag: string): SlotType | null {
  if (IMAGE_TAGS.has(tag)) return 'image';
  if (LINK_TAGS.has(tag)) return 'link';
  if (BUTTON_TAGS.has(tag) && (tag === 'button' || $(el).attr('type') === 'button' || $(el).attr('type') === 'submit')) {
    return 'button';
  }
  if (TEXT_TAGS.has(tag) && getDirectText($, el).length > 0) return 'text';
  return null;
}

function extractCandidate(
  $: cheerio.CheerioAPI,
  el: Element,
  tag: string,
  type: SlotType,
  path: string
): SlotCandidate | null {
  const id = stableId(path, type, tag);

  switch (type) {
    case 'image': {
      const src = $(el).attr('src') ?? '';
      if (!src) return null;
      return { id, type, value: src, alt: $(el).attr('alt') ?? '', tag, path, element: el };
    }
    case 'link': {
      const text = $(el).text().trim();
      if (!text) return null;
      return { id, type, value: text, href: $(el).attr('href') ?? '#', tag, path, element: el };
    }
    case 'button': {
      const value = tag === 'input' ? ($(el).attr('value') ?? '') : $(el).text().trim();
      if (!value) return null;
      return { id, type, value, tag, path, element: el };
    }
    case 'text': {
      const text = getDirectText($, el);
      if (!text.trim()) return null;
      return { id, type, value: text.trim(), tag, path, element: el };
    }
    default:
      return null;
  }
}

function getDirectText($: cheerio.CheerioAPI, el: Element): string {
  let text = '';
  for (const child of el.children ?? []) {
    if (child.type === 'text') {
      text += (child as AnyNode & { data?: string }).data ?? '';
    }
  }
  if (!text.trim()) {
    text = $(el).clone().children().remove().end().text();
  }
  return text;
}

function buildElementPath($: cheerio.CheerioAPI, el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current.tagName?.toLowerCase() !== 'body') {
    const tag = current.tagName?.toLowerCase() ?? 'unknown';
    const parent = current.parent as Element | null;
    if (parent) {
      const siblings = $(parent).children(tag);
      const index = siblings.toArray().indexOf(current);
      parts.unshift(`${tag}[${index}]`);
    } else {
      parts.unshift(`${tag}[0]`);
    }
    current = parent?.tagName?.toLowerCase() === 'body' ? null : parent;
  }

  return parts.join('>');
}

function stableId(path: string, type: SlotType, tag: string): string {
  const slug = path.replace(/[^a-z0-9[\]>-]/gi, '').replace(/>/g, '-').replace(/[[\]]/g, '');
  return `${type}-${tag}-${slug}`;
}

function filterLeafSlots(candidates: SlotCandidate[]): SlotCandidate[] {
  const paths = new Set(candidates.map((c) => c.path));
  return candidates.filter((c) => {
    if (c.type !== 'text') return true;
    // Drop text parent if a child text slot exists under same branch
    const hasChildSlot = [...paths].some(
      (p) => p !== c.path && p.startsWith(c.path + '>')
    );
    return !hasChildSlot;
  });
}

function replaceElementWithPlaceholder(
  $: cheerio.CheerioAPI,
  el: Element,
  id: string,
  type: SlotType
): void {
  const placeholder = slotPlaceholder(id);

  switch (type) {
    case 'image':
      $(el).replaceWith(placeholder);
      break;
    case 'link':
      $(el).replaceWith(placeholder);
      break;
    case 'button':
      $(el).replaceWith(placeholder);
      break;
    case 'text':
      $(el).html(placeholder);
      break;
  }
}

export function extractTemplateSlotIds(content: PageContent): string[] {
  const ids: string[] = [];
  const regex = /\{\{slot:([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content.template)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}
