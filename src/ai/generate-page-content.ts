/**
 * Chunk 8 — AI page-content-and-structure generator (single page).
 *
 * Produces one real `PageContent` (frozen template + `{{slot:id}}` slots +
 * authoritatively-tagged `containers`/`namedElements` with `source: 'generated'`)
 * from a selected `IndustryScaffold` (Chunk 7) and the site's active
 * `StyleGuide` (Chunk 1). The generator emits containers/named elements
 * directly — it never calls `deriveContainers` (per that module's docblock).
 *
 * Design (mirrors chat.ts's buildUserPrompt split):
 *  - Structure is DETERMINISTIC. A per-type layout table turns each scaffold
 *    section into semantic HTML using the theme's `.fp-*` classes, so content
 *    and brand bundle on the first pass. The AI only fills copy.
 *  - `buildGeneratedPage()` is pure: template + slots + containers +
 *    namedElements, with container/slot `path`s computed exactly the way
 *    `childPath()` does (same-tag sibling index among a parent's element
 *    children) so `injectElementIds()` resolves them at render time.
 *  - `buildGenerationPrompt()` / `parseGeneratedContent()` are pure and
 *    unit-tested with fixtures; only `generatePageContent()` touches the network.
 */
import type { ContainerNode, ContentSlot, PageContent, SlotType } from '../content/types.js';
import { slotPlaceholder } from '../content/types.js';
import { allocateNamedElements } from '../content/named-elements.js';
import { containerId } from '../content/containers.js';
import { callAiJson, extractJsonValue } from './call-json.js';
import { copyExcellence, formatDesignRulesBlock } from '../design/design-excellence.js';
import type { IndustryScaffold, SectionPattern } from '../design/section-patterns.js';
import type { AiCredentials } from './chat.js';

// ── Layout table: NamedElement type → deterministic semantic layout ──────────

interface LayoutField {
  /** Key the AI fills in `fields` (or a card item). */
  key: string;
  /** Wrapper element tag the slot lives in. */
  tag: string;
  className?: string;
  href?: string;
  slotType: 'text' | 'image';
  /** Used when the AI omits this field, so a generated page is never blank. */
  fallback: string;
}

interface LayoutCard {
  /** NamedElement type for each repeated card container. */
  type: string;
  fields: LayoutField[];
  min: number;
  max: number;
}

interface LayoutDesc {
  tag: string;
  className: string;
  fields: LayoutField[];
  card?: LayoutCard;
  /** Extra static attributes on the section element (e.g. a contact form's method + data hook). */
  attrs?: Record<string, string>;
  /** Raw, non-editable HTML injected before the final field — e.g. a contact form's inputs. Carries no slots/containers. */
  staticFields?: string;
}

const t = (key: string, tag: string, fallback: string, extra: Partial<LayoutField> = {}): LayoutField => ({
  key,
  tag,
  slotType: 'text',
  fallback,
  ...extra,
});

const PLACEHOLDER_IMG = 'https://placehold.co/1200x600';

/** Static (non-editable) contact-form inputs. Pure HTML — no scripts/handlers (the guardian
 *  rejects those in a template); publish channels wire the action + any JS enhancement. */
const CONTACT_FORM_FIELDS = [
  '<label class="fp-field">Name <input type="text" name="name" autocomplete="name" required /></label>',
  '<label class="fp-field">Email <input type="email" name="email" autocomplete="email" required /></label>',
  '<label class="fp-field">Message <textarea name="message" rows="4" required></textarea></label>',
].join('');

/** Static (non-editable) signup inputs — the newsletter twin of CONTACT_FORM_FIELDS.
 *  Name is optional on purpose: email alone must be enough to subscribe. */
const SIGNUP_FORM_FIELDS = [
  '<label class="fp-field">Name <input type="text" name="name" autocomplete="name" /></label>',
  '<label class="fp-field">Email <input type="email" name="email" autocomplete="email" required /></label>',
].join('');

/** Per-core-type layout. Types without an entry fall back to GENERIC_LAYOUT. */
const LAYOUTS: Record<string, LayoutDesc> = {
  Nav: {
    tag: 'nav',
    className: 'fp-nav',
    fields: [
      t('brand', 'span', 'Brand', { className: 'fp-brand' }),
      t('navLink1', 'a', 'Home', { href: '#' }),
      t('navLink2', 'a', 'About', { href: '#' }),
      t('navLink3', 'a', 'Contact', { href: '#' }),
      t('navCta', 'a', 'Get started', { href: '#', className: 'fp-btn-primary' }),
    ],
  },
  Header: {
    tag: 'header',
    className: 'fp-nav',
    fields: [t('brand', 'span', 'Brand', { className: 'fp-brand' }), t('tagline', 'span', 'Welcome')],
  },
  HeroSection: {
    tag: 'section',
    className: 'fp-hero',
    fields: [
      t('headline', 'h1', 'Your headline goes here'),
      t('subhead', 'p', 'A short supporting sentence that explains the value.', { className: 'fp-body-lg' }),
      t('primaryCta', 'a', 'Get started', { href: '#', className: 'fp-btn-primary' }),
      t('secondaryCta', 'a', 'Learn more', { href: '#', className: 'fp-btn-secondary' }),
    ],
  },
  HeroImage: {
    tag: 'section',
    className: 'fp-hero',
    fields: [t('image', 'div', PLACEHOLDER_IMG, { slotType: 'image', className: 'fp-hero-image' })],
  },
  Title: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'Section title'), t('subtitle', 'p', 'A short intro line.')],
  },
  FeatureGrid: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'What we offer')],
    card: {
      type: 'InfoCard',
      min: 3,
      max: 6,
      fields: [t('title', 'h3', 'Feature'), t('body', 'p', 'A short benefit description.')],
    },
  },
  InfoCard: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'About'), t('body', 'p', 'A short paragraph about what this is and who it is for.')],
  },
  PricingTable: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'Pricing')],
    card: {
      type: 'PricingCard',
      min: 2,
      max: 4,
      fields: [
        t('name', 'h3', 'Plan'),
        t('price', 'p', '$0', { className: 'fp-display-md' }),
        t('features', 'p', 'Everything you need to get started.'),
      ],
    },
  },
  TestimonialCard: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'What customers say')],
    card: {
      type: 'TestimonialCard',
      min: 1,
      max: 3,
      fields: [t('quote', 'blockquote', 'This made all the difference for us.'), t('author', 'p', '— A happy customer', { className: 'fp-caption' })],
    },
  },
  FAQItem: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'Frequently asked questions')],
    card: {
      type: 'FAQItem',
      min: 2,
      max: 6,
      fields: [t('q', 'h3', 'A common question?'), t('a', 'p', 'A clear, reassuring answer.')],
    },
  },
  CTASection: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('headline', 'h2', 'Ready to get started?'), t('button', 'a', 'Get started', { href: '#', className: 'fp-btn-primary' })],
  },
  // A REAL, submittable contact form: editable title/intro/submit copy plus static
  // name/email/message fields and a stable `data-fp-form="contact"` hook. It carries
  // no action here (siteId is unknown at generation) — each publish channel wires the
  // action: the WordPress Connector plugin points it at the site's contact endpoint.
  Form: {
    tag: 'form',
    className: 'fp-section fp-contact-form',
    attrs: { method: 'post', 'data-fp-form': 'contact' },
    fields: [
      t('title', 'h2', 'Get in touch'),
      t('intro', 'p', 'Tell us what you need and we will get back to you.'),
      // A <button> with no type defaults to submit inside a <form>.
      t('submit', 'button', 'Send', { className: 'fp-btn-primary' }),
    ],
    staticFields: CONTACT_FORM_FIELDS,
  },
  // Newsletter-signup twin of Form: editable title/intro/submit copy plus static
  // name/email fields and the stable `data-fp-form="signup"` hook. Like the contact
  // form it carries no action — today only the WordPress Connector plugin wires it
  // to the site's public /subscribe endpoint (double opt-in); static/Vercel publish
  // doesn't, which is one reason generation adds it only on an explicit opt-in.
  SignupForm: {
    tag: 'form',
    className: 'fp-section fp-signup-form',
    attrs: { method: 'post', 'data-fp-form': 'signup' },
    fields: [
      t('title', 'h2', 'Stay in the loop'),
      t('intro', 'p', 'Occasional updates, no spam — unsubscribe anytime.'),
      t('submit', 'button', 'Subscribe', { className: 'fp-btn-primary' }),
    ],
    staticFields: SIGNUP_FORM_FIELDS,
  },
  Gallery: {
    tag: 'section',
    className: 'fp-section',
    fields: [t('title', 'h2', 'Gallery')],
    card: {
      type: 'InfoCard',
      min: 3,
      max: 8,
      fields: [t('image', 'div', PLACEHOLDER_IMG, { slotType: 'image', className: 'fp-gallery-item' }), t('caption', 'p', 'Caption', { className: 'fp-caption' })],
    },
  },
  Footer: {
    tag: 'footer',
    className: 'fp-footer',
    fields: [t('text', 'p', '© Your Company'), t('links', 'p', 'Privacy · Terms · Contact', { className: 'fp-caption' })],
  },
};

const GENERIC_LAYOUT: LayoutDesc = {
  tag: 'section',
  className: 'fp-section',
  fields: [t('title', 'h2', 'Section'), t('body', 'p', 'Section content.')],
};

export function layoutForType(type: string): LayoutDesc {
  return LAYOUTS[type] ?? GENERIC_LAYOUT;
}

// ── AI content shape ─────────────────────────────────────────────────────────

export interface GeneratedSectionContent {
  /** Scaffold section id. */
  id: string;
  fields: Record<string, string>;
  items: Array<Record<string, string>>;
}

export interface GeneratedContent {
  sections: GeneratedSectionContent[];
}

// ── Internal element tree (drives both HTML and container/slot paths) ────────

interface SlotMeta {
  id: string;
  type: SlotType;
  value: string;
  alt?: string;
}

interface El {
  tag: string;
  className?: string;
  href?: string;
  /** Extra static attributes (e.g. method, data-fp-form on a contact form). */
  attrs?: Record<string, string>;
  /** When set, this element is a named container of the given taxonomy type. */
  containerType?: string;
  /** A leaf slot placeholder rendered as this element's text content. */
  slot?: SlotMeta;
  /** Verbatim HTML emitted in place — no tag wrapper, no slots, no containers. */
  rawHtml?: string;
  children: El[];
}

const el = (tag: string, opts: Partial<Omit<El, 'tag' | 'children'>> & { children?: El[] } = {}): El => ({
  tag,
  className: opts.className,
  href: opts.href,
  attrs: opts.attrs,
  containerType: opts.containerType,
  slot: opts.slot,
  rawHtml: opts.rawHtml,
  children: opts.children ?? [],
});

/**
 * Build a slot from a layout field + the AI's data for its container. Image slots keep the
 * placeholder URL (the model can't supply real image files) and take ONLY the model's `<key>Alt`
 * text — so the AI never writes junk into an `<img src>`. Text slots take the model's copy.
 */
function fieldSlot(id: string, f: LayoutField, data: Record<string, string>): SlotMeta {
  if (f.slotType === 'image') {
    return { id, type: 'image', value: f.fallback, alt: (data[`${f.key}Alt`] ?? '').toString().trim() || undefined };
  }
  return { id, type: 'text', value: (data[f.key] ?? '').toString().trim() || f.fallback };
}

/** One included section merged with its AI copy → an element subtree + its container type. */
function sectionElement(sectionId: string, type: string, content: GeneratedSectionContent | undefined): El {
  const layout = layoutForType(type);
  const fields = content?.fields ?? {};

  const fieldEl = (f: LayoutField, id: string, data: Record<string, string>): El =>
    el(f.tag, { className: f.className, href: f.href, slot: fieldSlot(id, f, data) });

  const children: El[] = layout.fields.map((f) => fieldEl(f, `${sectionId}__${f.key}`, fields));

  if (layout.staticFields) {
    // Insert the raw fields before the final field (the submit control). The raw node
    // carries no slots/containers and its tag differs from every field tag, so the
    // existing fields' sibling-index paths are unchanged.
    children.splice(Math.max(0, children.length - 1), 0, el('', { rawHtml: layout.staticFields }));
  }

  if (layout.card) {
    const card = layout.card;
    const items = content?.items ?? [];
    const count = Math.max(card.min, Math.min(card.max, items.length || card.min));
    for (let i = 0; i < count; i++) {
      const item = items[i] ?? {};
      children.push(
        el('div', {
          className: 'fp-card',
          containerType: card.type,
          children: card.fields.map((f) => fieldEl(f, `${sectionId}__c${i + 1}__${f.key}`, item)),
        })
      );
    }
  }

  return el(layout.tag, { className: layout.className, attrs: layout.attrs, containerType: type, children });
}

interface WalkAcc {
  slots: Record<string, ContentSlot>;
  slotOrder: string[];
}

interface WalkResult {
  html: string;
  /** The container subtree when this node is a named container, else null. */
  container: ContainerNode | null;
  /** Slot ids owned by this node's subtree that belong to the nearest ANCESTOR container (bubble up). */
  leafSlotIds: string[];
}

const attrEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Emit HTML + collect slots for one element at the already-computed `path`,
 * indexing children exactly as `childPath()` does (same-tag sibling index,
 * 0-based). Slot placeholders are text, never counted as elements — mirroring
 * the render pipeline where `injectElementIds` runs before slot substitution.
 */
function walk(node: El, path: string, acc: WalkAcc): WalkResult {
  // A raw node is emitted verbatim — it owns no slots or containers and never
  // participates in path computation.
  if (node.rawHtml !== undefined) {
    return { html: node.rawHtml, container: null, leafSlotIds: [] };
  }

  const extraAttrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${attrEscape(v)}"`)
        .join('')
    : '';
  const attrs =
    (node.className ? ` class="${attrEscape(node.className)}"` : '') +
    (node.href ? ` href="${attrEscape(node.href)}"` : '') +
    extraAttrs;

  const directSlotIds: string[] = [];
  const childContainers: ContainerNode[] = [];
  let inner = '';

  if (node.slot) {
    acc.slots[node.slot.id] = {
      id: node.slot.id,
      type: node.slot.type,
      value: node.slot.value,
      alt: node.slot.type === 'image' ? node.slot.alt : undefined,
      tag: node.slot.type === 'image' ? 'img' : node.tag,
      path,
    };
    acc.slotOrder.push(node.slot.id);
    inner = slotPlaceholder(node.slot.id);
    directSlotIds.push(node.slot.id);
  } else {
    const counts = new Map<string, number>();
    for (const child of node.children) {
      const idx = counts.get(child.tag) ?? 0;
      counts.set(child.tag, idx + 1);
      const childPath = path ? `${path}>${child.tag}[${idx}]` : `${child.tag}[${idx}]`;
      const res = walk(child, childPath, acc);
      inner += res.html;
      if (res.container) childContainers.push(res.container);
      else directSlotIds.push(...res.leafSlotIds);
    }
  }

  const html = `<${node.tag}${attrs}>${inner}</${node.tag}>`;

  const container: ContainerNode | null = node.containerType
    ? {
        id: path === '' ? 'page-root' : containerId(path),
        path,
        tag: node.tag,
        suggestedType: node.containerType,
        slotIds: directSlotIds,
        children: childContainers,
      }
    : null;

  // A container captures its own slots; only a non-container bubbles them to its parent container.
  return { html, container, leafSlotIds: container ? [] : directSlotIds };
}

// ── Pure page builder ────────────────────────────────────────────────────────

export interface BuiltSection {
  id: string;
  type: string;
  content?: GeneratedSectionContent;
}

/**
 * Build a complete `PageContent` from included sections + their AI copy.
 * Pure and deterministic — same input, same output. Emits authoritative
 * containers/namedElements (`source: 'generated'`) and a template whose element
 * paths the render pipeline can resolve. `pageNumber` is 1-based per site.pages.
 */
export function buildGeneratedPage(sections: BuiltSection[], pageNumber = 1): PageContent {
  const body: El = el('body', {
    containerType: 'Page',
    children: sections.map((s) => sectionElement(s.id, s.type, s.content)),
  });

  // Walk the body node itself (path ''); it produces the template and the
  // page-root container via the exact same sibling-indexing logic as every other
  // node — no separate copy of the loop to keep in sync.
  const acc: WalkAcc = { slots: {}, slotOrder: [] };
  const res = walk(body, '', acc);
  const template = res.html;
  const pageRoot = res.container!; // body always has containerType 'Page'

  const allocated = allocateNamedElements([pageRoot], {}, pageNumber, 'generated');

  return {
    template,
    slots: acc.slots,
    slotOrder: acc.slotOrder,
    containers: allocated.containers,
    namedElements: allocated.namedElements,
  };
}

// ── Scaffold → included sections (fan-out drops optional sections) ───────────

/**
 * Resolve which sections are included. STRUCTURE IS DETERMINISTIC: the fan-out's
 * `dropSectionIds` is the sole structural lever — an optional section is included
 * unless the fan-out dropped it; required sections are always in. The AI's copy
 * is attached, but the model does NOT get to change the structure (that would let
 * a plan's fingerprint diverge from the page it actually produces and could
 * silently collapse two "distinct" directions into the same layout). An opt-in
 * section (the newsletter signup) is out unless `includeOptIn` — one per-request
 * switch applied to every direction alike, so it never varies structure between
 * them. Returns the ordered BuiltSections.
 */
export function selectIncludedSections(
  scaffold: IndustryScaffold,
  content: GeneratedContent,
  dropSectionIds: string[] = [],
  includeOptIn = false
): BuiltSection[] {
  const byId = new Map(content.sections.map((s) => [s.id, s]));
  const drop = new Set(dropSectionIds);
  const result: BuiltSection[] = [];
  for (const section of scaffold.sections) {
    if (section.optIn && !includeOptIn) continue; // opt-in only (plan-gated upstream)
    if (section.optional && drop.has(section.id)) continue; // fan-out avoid set only
    result.push({ id: section.id, type: section.type, content: byId.get(section.id) });
  }
  return result;
}

// ── Prompt (pure) ────────────────────────────────────────────────────────────

export interface GenerationContext {
  brandName: string;
  industry?: string;
  personality?: string[];
  targetAudience?: string;
  moodKeywords?: string[];
  /** The active StyleGuide's design-direction string (guide.aiSystemPromptAddition). */
  designDirection?: string;
  /** Fan-out steering: a short instruction making this direction diverge from prior ones. */
  variationDirective?: string;
  /** Approved Deep Brand Research context block (buildBrandVoiceContext) — voice, beliefs, customer phrasing. */
  brandResearch?: string;
  /** The brand's own DESIGN.md guardrail prose (guide.designRules), capped at DESIGN_RULES_MAX_CHARS. */
  designRules?: string;
}

/** The key the model fills for a field — image fields ask for alt TEXT (`<key>Alt`), not a URL. */
function promptKey(f: LayoutField): string {
  return f.slotType === 'image' ? `${f.key}Alt` : f.key;
}

/** Describe a section's expected copy for the prompt, derived from its layout. */
function describeSectionForPrompt(section: SectionPattern): string {
  const layout = layoutForType(section.type);
  const fieldKeys = layout.fields.map(promptKey);
  const parts = [`- id "${section.id}" (${section.type}${section.optional ? ', optional' : ''}): ${section.intent}`];
  if (fieldKeys.length) parts.push(`    fields: ${fieldKeys.join(', ')}`);
  if (layout.card) parts.push(`    items[]: ${layout.card.min}-${layout.card.max} of { ${layout.card.fields.map(promptKey).join(', ')} }`);
  return parts.join('\n');
}

export function buildGenerationPrompt(
  scaffold: IndustryScaffold,
  ctx: GenerationContext,
  includeOptIn = false
): { system: string; user: string } {
  const system = `You are a senior website copywriter. You are given a page composed of an ordered list of
sections. Write concise, specific, on-brand copy for each section — real sentences, not lorem ipsum,
never marketing cliché filler. Keep headlines under ~8 words and body text under ~2 sentences.

Respond with ONLY valid JSON in this exact shape:
{
  "sections": [
    { "id": "<section id>", "fields": { "<key>": "<copy>" }, "items": [ { "<key>": "<copy>" } ] }
  ]
}

Rules:
- Include one object per section id listed below, in the same order. The page structure is fixed —
  write copy for every section (you do not choose which sections appear).
- Fill every listed field key with real copy. For a section that lists items[], return that many item objects.
- Do NOT invent new section ids or field keys. Do NOT write HTML, CSS, or markdown — plain text values only.

${copyExcellence()}`;

  const rulesBlock = formatDesignRulesBlock(ctx.designRules);
  const ctxLines = [
    `Brand: ${ctx.brandName}`,
    ctx.industry ? `Industry: ${ctx.industry}` : '',
    ctx.personality?.length ? `Personality: ${ctx.personality.join(', ')}` : '',
    ctx.targetAudience ? `Audience: ${ctx.targetAudience}` : '',
    ctx.moodKeywords?.length ? `Mood: ${ctx.moodKeywords.join(', ')}` : '',
    ctx.designDirection ? `Design direction: ${ctx.designDirection}` : '',
    ctx.variationDirective ? `This version's angle: ${ctx.variationDirective}` : '',
    ctx.brandResearch ? `\n${ctx.brandResearch}` : '',
    // formatDesignRulesBlock owns the label and the cap, so this prompt can
    // never drift from the chat prompt's rules block.
    rulesBlock ? `\n${rulesBlock}` : '',
  ].filter(Boolean);

  const user = `${ctxLines.join('\n')}

Page: ${scaffold.name} (${scaffold.industry})
Sections (write copy for each):
${scaffold.sections.filter((s) => includeOptIn || !s.optIn).map(describeSectionForPrompt).join('\n')}`;

  return { system, user };
}

// ── Parse (pure) ─────────────────────────────────────────────────────────────

/**
 * Parse the AI JSON into a normalized GeneratedContent, keeping only known
 * section ids and coercing shapes defensively (never throws). Unknown ids are
 * dropped; missing sections simply fall back to layout defaults downstream.
 */
export function parseGeneratedContent(text: string, scaffold: IndustryScaffold): GeneratedContent {
  const validIds = new Set(scaffold.sections.map((s) => s.id));
  const out: GeneratedContent = { sections: [] };

  const parsed = extractJsonValue(text, 'object');
  if (!parsed) return out;

  const rawSections = (parsed as { sections?: unknown }).sections;
  if (!Array.isArray(rawSections)) return out;

  const seen = new Set<string>();
  for (const raw of rawSections) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : undefined;
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);

    const fields: Record<string, string> = {};
    if (r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields)) {
      for (const [k, v] of Object.entries(r.fields as Record<string, unknown>)) {
        if (typeof v === 'string') fields[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') fields[k] = String(v);
      }
    }

    const items: Array<Record<string, string>> = [];
    if (Array.isArray(r.items)) {
      for (const item of r.items) {
        if (!item || typeof item !== 'object') continue;
        const obj: Record<string, string> = {};
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (typeof v === 'string') obj[k] = v;
          else if (typeof v === 'number' || typeof v === 'boolean') obj[k] = String(v);
        }
        items.push(obj);
      }
    }

    out.sections.push({ id, fields, items });
  }

  return out;
}

/**
 * Generate one page from a scaffold: ask the AI for copy, then deterministically
 * assemble the authoritative PageContent. `dropSectionIds` lets the directions
 * orchestrator vary structure; `includeOptIn` adds opt-in sections (signup). If
 * the AI is unreachable, the page still builds from layout fallbacks (never blank).
 */
export async function generatePageContent(
  scaffold: IndustryScaffold,
  ctx: GenerationContext,
  credentials: AiCredentials,
  opts: { pageNumber?: number; dropSectionIds?: string[]; includeOptIn?: boolean } = {}
): Promise<PageContent> {
  const { system, user } = buildGenerationPrompt(scaffold, ctx, opts.includeOptIn);
  let content: GeneratedContent = { sections: [] };
  try {
    const text = await callAiJson(system, user, credentials, { maxTokens: 3072 });
    content = parseGeneratedContent(text, scaffold);
  } catch (err) {
    // Fall back to a fully-defaulted (never-blank) page, but don't fail silently: a swallowed
    // error here (e.g. a stale configured model id) otherwise shows up only as generic placeholder
    // copy with no signal. Log it so a misconfiguration is diagnosable.
    console.warn(`[generate-page-content] AI copy failed, using layout fallbacks: ${err instanceof Error ? err.message : String(err)}`);
  }
  const sections = selectIncludedSections(scaffold, content, opts.dropSectionIds, opts.includeOptIn);
  return buildGeneratedPage(sections, opts.pageNumber ?? 1);
}

/** The ordered section-type fingerprint of a built page's included sections (fan-out avoid-list). */
export function pageFingerprint(sections: BuiltSection[]): string[] {
  return sections.map((s) => s.type);
}
