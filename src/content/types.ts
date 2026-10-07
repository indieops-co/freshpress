export type SlotType = 'text' | 'image' | 'link' | 'button';

export interface ContentSlot {
  id: string;
  type: SlotType;
  value: string;
  href?: string;
  alt?: string;
  tag: string;
  /** Structural path used for stable IDs and section grouping */
  path: string;
}

/**
 * A structural container in the page — the unit Friendly Named Elements
 * address ("InfoCard-2-p1"). Derived heuristically for ingested/legacy pages
 * (src/content/containers.ts) or emitted authoritatively by the generator.
 */
export interface ContainerNode {
  /** Stable within the page, derived from the DOM path */
  id: string;
  /** DOM path in ingest format (tag[i]>tag[j]…, body-relative; '' = page root) */
  path: string;
  tag: string;
  /** Taxonomy type proposed by derivation — consumed by named-element allocation */
  suggestedType?: string;
  /** Id of the NamedElement addressing this container, once allocated */
  elementId?: string;
  /** Slots directly inside this container (not inside a child container) */
  slotIds: string[];
  children: ContainerNode[];
}

/** A user-addressable, friendly-named page element ("InfoCard-2-p1"). */
export interface NamedElement {
  id: string;
  /** Taxonomy type — core list or per-site discovered type */
  type: string;
  /** 1-based per type per page; gaps persist on delete, never renumbered */
  index: number;
  /** 1-based position of the page in site.pages — reconciled on save */
  pageNumber: number;
  containerId: string;
  /** Structured whitelisted style overrides — token refs only, distinct from the raw customCss escape hatch */
  styleOverrides?: ElementStyleOverrides;
  /** Advanced per-element raw CSS override (declaration list only, Guardian-validated) */
  customCss?: string;
  source: 'heuristic' | 'generated';
}

/** Whitelisted per-element style properties. Every value must be a token name from the site's StyleGuide (spacing/radii/shadows/colors) — never a raw CSS value. */
export interface ElementStyleOverrides {
  padding?: string;
  margin?: string;
  radius?: string;
  shadow?: string;
  background?: string;
  textColor?: string;
}

/** AI-chat proposed structured style change for one named element, Guardian-validated against ElementStyleOverrides' token whitelist. */
export interface ElementStyleChange extends ElementStyleOverrides {
  elementId: string;
}

/** AI-chat proposed raw CSS override for one named element — the separate, explicitly-gated escape hatch (Amendment A). */
export interface ElementCustomCssChange {
  elementId: string;
  customCss: string;
}

export interface PageContent {
  /** Frozen HTML template with {{slot:id}} placeholders */
  template: string;
  slots: Record<string, ContentSlot>;
  /** Ordered slot IDs — used by Guardian to detect removed sections */
  slotOrder: string[];
  /** Structural container tree (roots) — absent until derived/generated */
  containers?: ContainerNode[];
  /** NamedElement id -> element — absent until derived/generated */
  namedElements?: Record<string, NamedElement>;
}

export interface IngestResult {
  sourceUrl: string;
  pagePath: string;
  title: string;
  content: PageContent;
}

export interface SlotChange {
  slotId: string;
  value?: string;
  href?: string;
  alt?: string;
}

export interface GuardianResult {
  ok: boolean;
  errors: string[];
  applied?: Record<string, ContentSlot>;
}

export const SLOT_PLACEHOLDER_PREFIX = '{{slot:';
export const SLOT_PLACEHOLDER_SUFFIX = '}}';

export function slotPlaceholder(id: string): string {
  return `${SLOT_PLACEHOLDER_PREFIX}${id}${SLOT_PLACEHOLDER_SUFFIX}`;
}

export function parseSlotPlaceholder(text: string): string | null {
  const match = text.match(/^\{\{slot:([^}]+)\}\}$/);
  return match ? match[1] : null;
}
