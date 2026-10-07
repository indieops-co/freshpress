import { XMLParser } from 'fast-xml-parser';
import type { ImportPreview } from '../../content/blog-types.js';

export interface WxrAuthor {
  wpAuthorId: number;
  login: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
}

export interface WxrCategory {
  wpTermId: number;
  slug: string;
  name: string;
  parentSlug?: string;
}

export interface WxrTag {
  wpTermId: number;
  slug: string;
  name: string;
}

export interface WxrPostMeta {
  key: string;
  value: string;
}

export interface WxrComment {
  wpCommentId: number;
  author: string;
  authorEmail?: string;
  authorUrl?: string;
  content: string;
  approved: string;
  date: string;
  parentId: number;
}

export interface WxrItemCategory {
  domain: string;
  slug: string;
  name: string;
}

export interface WxrItem {
  title: string;
  link: string;
  creator?: string;
  content?: string;
  excerpt?: string;
  wpPostId: number;
  postDate?: string;
  slug: string;
  status: string;
  postType: string;
  attachmentUrl?: string;
  postMeta: WxrPostMeta[];
  categories: WxrItemCategory[];
  comments: WxrComment[];
}

export interface ParsedWxr {
  siteName: string;
  siteUrl?: string;
  wxrVersion?: string;
  authors: WxrAuthor[];
  categories: WxrCategory[];
  tags: WxrTag[];
  items: WxrItem[];
}

function textVal(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return textVal(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#text' in o) return textVal(o['#text']);
    if (Object.keys(o).length === 0) return '';
  }
  return '';
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseMeta(item: Record<string, unknown>): WxrPostMeta[] {
  const metas = asArray(item['wp:postmeta'] as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return metas.map((m) => ({
    key: textVal(m['wp:meta_key']),
    value: textVal(m['wp:meta_value']),
  }));
}

function parseComments(item: Record<string, unknown>): WxrComment[] {
  const comments = asArray(item['wp:comment'] as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return comments.map((c) => ({
    wpCommentId: Number(textVal(c['wp:comment_id']) || 0),
    author: textVal(c['wp:comment_author']),
    authorEmail: textVal(c['wp:comment_author_email']) || undefined,
    authorUrl: textVal(c['wp:comment_author_url']) || undefined,
    content: textVal(c['wp:comment_content']),
    approved: textVal(c['wp:comment_approved']),
    date: textVal(c['wp:comment_date']),
    parentId: Number(textVal(c['wp:comment_parent']) || 0),
  }));
}

function parseItemCategories(item: Record<string, unknown>): WxrItemCategory[] {
  const cats = asArray(item.category as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return cats.map((c) => ({
    domain: textVal(c['@_domain']),
    slug: textVal(c['@_nicename']),
    name: textVal(c),
  }));
}

function parseItem(item: Record<string, unknown>): WxrItem {
  return {
    title: textVal(item.title),
    link: textVal(item.link),
    creator: textVal(item['dc:creator']) || undefined,
    content: textVal(item['content:encoded']) || undefined,
    excerpt: textVal(item['excerpt:encoded']) || undefined,
    wpPostId: Number(textVal(item['wp:post_id']) || 0),
    postDate: textVal(item['wp:post_date']) || undefined,
    slug: textVal(item['wp:post_name']),
    status: textVal(item['wp:status']),
    postType: textVal(item['wp:post_type']),
    attachmentUrl: textVal(item['wp:attachment_url']) || undefined,
    postMeta: parseMeta(item),
    categories: parseItemCategories(item),
    comments: parseComments(item),
  };
}

/** Parse a WordPress WXR export file */
export function parseWxr(xml: string): ParsedWxr {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    processEntities: true,
    isArray: (name) =>
      ['item', 'wp:author', 'wp:category', 'wp:tag', 'wp:postmeta', 'wp:comment', 'category'].includes(name),
  });

  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (!rss) throw new Error('Invalid WXR: missing rss root element');

  const channel = rss.channel as Record<string, unknown> | undefined;
  if (!channel) throw new Error('Invalid WXR: missing channel element');

  const authors = asArray(channel['wp:author'] as Record<string, unknown> | Record<string, unknown>[] | undefined).map(
    (a) => ({
      wpAuthorId: Number(textVal(a['wp:author_id']) || 0),
      login: textVal(a['wp:author_login']),
      email: textVal(a['wp:author_email']),
      displayName: textVal(a['wp:author_display_name']) || textVal(a['wp:author_login']),
      firstName: textVal(a['wp:author_first_name']) || undefined,
      lastName: textVal(a['wp:author_last_name']) || undefined,
    })
  );

  const categories = asArray(
    channel['wp:category'] as Record<string, unknown> | Record<string, unknown>[] | undefined
  ).map((c) => {
    const parent = textVal(c['wp:category_parent']);
    return {
      wpTermId: Number(textVal(c['wp:term_id']) || 0),
      slug: textVal(c['wp:category_nicename']),
      name: textVal(c['wp:cat_name']),
      parentSlug: parent || undefined,
    };
  });

  const tags = asArray(channel['wp:tag'] as Record<string, unknown> | Record<string, unknown>[] | undefined).map(
    (t) => ({
      wpTermId: Number(textVal(t['wp:term_id']) || 0),
      slug: textVal(t['wp:tag_slug']),
      name: textVal(t['wp:tag_name']),
    })
  );

  const items = asArray(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined).map(parseItem);

  return {
    siteName: textVal(channel.title) || 'Imported Site',
    siteUrl: textVal(channel.link) || undefined,
    wxrVersion: textVal(channel['wp:wxr_version']) || undefined,
    authors,
    categories,
    tags,
    items,
  };
}

export function buildImportPreview(parsed: ParsedWxr): ImportPreview {
  const attachments = parsed.items.filter((i) => i.postType === 'attachment');
  const posts = parsed.items.filter((i) => i.postType === 'post');
  const pages = parsed.items.filter((i) => i.postType === 'page');
  const commentCount = parsed.items.reduce((n, i) => n + i.comments.length, 0);

  let suggestedDomain: string | undefined;
  if (parsed.siteUrl) {
    try {
      suggestedDomain = new URL(parsed.siteUrl).hostname;
    } catch {
      suggestedDomain = undefined;
    }
  }

  return {
    siteName: parsed.siteName,
    siteUrl: parsed.siteUrl,
    suggestedDomain,
    counts: {
      authors: parsed.authors.length,
      categories: parsed.categories.length,
      tags: parsed.tags.length,
      attachments: attachments.length,
      articles: posts.length + pages.length,
      comments: commentCount,
      sitePages: 0,
      mediaFailed: 0,
    },
    authors: parsed.authors.map((a) => ({
      login: a.login,
      displayName: a.displayName,
      email: a.email,
    })),
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      wpPostId: p.wpPostId,
    })),
  };
}

/** Sort categories so parents are imported before children */
export function sortCategoriesParentFirst(categories: WxrCategory[]): WxrCategory[] {
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const sorted: WxrCategory[] = [];
  const seen = new Set<string>();

  function visit(cat: WxrCategory) {
    if (seen.has(cat.slug)) return;
    if (cat.parentSlug && cat.parentSlug !== cat.slug && bySlug.has(cat.parentSlug)) {
      visit(bySlug.get(cat.parentSlug)!);
    }
    seen.add(cat.slug);
    sorted.push(cat);
  }

  for (const cat of categories) visit(cat);
  return sorted;
}

export function getMetaValue(item: WxrItem, key: string): string | undefined {
  return item.postMeta.find((m) => m.key === key)?.value;
}
