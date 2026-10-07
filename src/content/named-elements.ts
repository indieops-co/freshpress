import type { ContainerNode, NamedElement, PageContent } from './types.js';
import { deriveContainers, flattenContainers } from './containers.js';

/**
 * Friendly Named Elements: taxonomy, ID allocation, and save-time page-number
 * reconciliation. IDs read {Type}-{index}-p{page} ("InfoCard-2-p1"): index is
 * 1-based per type per page and survives deletes as a gap (never renumbered);
 * the -pN suffix tracks the page's position in site.pages and is reconciled
 * whenever page order changes.
 */

export const CORE_ELEMENT_TYPES = [
  'Page',
  'Header',
  'Nav',
  'Footer',
  'Sidebar',
  'HeroSection',
  'HeroImage',
  'Title',
  'InfoCard',
  'FeatureGrid',
  'PricingTable',
  'PricingCard',
  'TestimonialCard',
  'FAQItem',
  'CTASection',
  'Form',
  'SignupForm',
  'Gallery',
  'LogoMark',
  'Section',
] as const;

const CORE_TYPE_SET = new Set<string>(CORE_ELEMENT_TYPES);

/** PascalCase-normalize a proposed type ("service area map" → "ServiceAreaMap"). */
export function normalizeElementType(raw: string): string {
  return raw
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Resolve a proposed type against the taxonomy: core types pass through;
 * previously discovered site types are reused (exact match after
 * normalization) so regeneration doesn't drift to synonyms; anything else is
 * a new discovered type the caller should persist to the site registry.
 */
export function resolveElementType(
  raw: string,
  discoveredTypes: string[] = []
): { type: string; isNew: boolean } {
  const type = normalizeElementType(raw);
  if (CORE_TYPE_SET.has(type) || discoveredTypes.includes(type)) {
    return { type, isNew: false };
  }
  return { type, isNew: true };
}

export function formatElementId(type: string, index: number, pageNumber: number): string {
  return `${type}-${index}-p${pageNumber}`;
}

const ELEMENT_ID_PATTERN = /^(.+)-(\d+)-p(\d+)$/;

export function parseElementId(
  id: string
): { type: string; index: number; pageNumber: number } | null {
  const match = ELEMENT_ID_PATTERN.exec(id);
  if (!match) return null;
  return { type: match[1], index: Number(match[2]), pageNumber: Number(match[3]) };
}

/**
 * Allocate NamedElements for typed containers, preserving any existing
 * allocations (matched by containerId). New elements of a type take
 * max-existing-index + 1 — deleted indexes stay as gaps.
 */
export function allocateNamedElements(
  containers: ContainerNode[],
  existing: Record<string, NamedElement> = {},
  pageNumber: number,
  /** Provenance stamped on newly-created elements — 'heuristic' (derivation) or 'generated' (Chunk 8). */
  source: NamedElement['source'] = 'heuristic'
): { containers: ContainerNode[]; namedElements: Record<string, NamedElement> } {
  const byContainer = new Map<string, NamedElement>();
  for (const el of Object.values(existing)) {
    byContainer.set(el.containerId, el);
  }

  const nextIndex = new Map<string, number>();
  for (const el of Object.values(existing)) {
    nextIndex.set(el.type, Math.max(nextIndex.get(el.type) ?? 0, el.index));
  }

  const namedElements: Record<string, NamedElement> = {};

  for (const node of flattenContainers(containers)) {
    const kept = byContainer.get(node.id);
    if (kept) {
      node.elementId = kept.id;
      namedElements[kept.id] = kept;
      continue;
    }

    if (!node.suggestedType) continue;
    const type = node.suggestedType;
    const index = (nextIndex.get(type) ?? 0) + 1;
    nextIndex.set(type, index);

    const element: NamedElement = {
      id: formatElementId(type, index, pageNumber),
      type,
      index,
      pageNumber,
      containerId: node.id,
      source,
    };
    node.elementId = element.id;
    namedElements[element.id] = element;
  }

  return { containers, namedElements };
}

/** Derive containers + named elements for a page that has neither. */
export function deriveNamedElements(content: PageContent, pageNumber: number): PageContent {
  const containers = deriveContainers(content);
  const allocated = allocateNamedElements(containers, content.namedElements, pageNumber);
  return { ...content, containers: allocated.containers, namedElements: allocated.namedElements };
}

/** Lazy backfill: no-op when the page already carries container/element data. */
export function deriveIfMissing(content: PageContent, pageNumber: number): PageContent {
  if (content.containers && content.namedElements) return content;
  return deriveNamedElements(content, pageNumber);
}

/**
 * Save-time -pN reconciliation: page numbers follow position in site.pages
 * (1-based). Rewrites element ids/pageNumbers (and container elementId refs)
 * for pages whose position changed. Index compaction is deliberately NOT done
 * here — indexes are stable identity.
 */
export function reconcilePageNumbers<T extends { content: PageContent }>(
  pages: T[]
): { pages: T[]; changed: boolean } {
  let changed = false;

  const result = pages.map((page, i) => {
    const pageNumber = i + 1;
    const elements = page.content.namedElements;
    if (!elements) return page;

    const needsUpdate = Object.values(elements).some((el) => el.pageNumber !== pageNumber);
    if (!needsUpdate) return page;

    changed = true;
    const idMap = new Map<string, string>();
    const remapped: Record<string, NamedElement> = {};
    for (const el of Object.values(elements)) {
      const newId = formatElementId(el.type, el.index, pageNumber);
      idMap.set(el.id, newId);
      remapped[newId] = { ...el, id: newId, pageNumber };
    }

    const containers = page.content.containers
      ? remapContainerRefs(page.content.containers, idMap)
      : page.content.containers;

    return {
      ...page,
      content: { ...page.content, namedElements: remapped, containers },
    };
  });

  return { pages: result, changed };
}

function remapContainerRefs(nodes: ContainerNode[], idMap: Map<string, string>): ContainerNode[] {
  return nodes.map((node) => ({
    ...node,
    elementId: node.elementId ? (idMap.get(node.elementId) ?? node.elementId) : node.elementId,
    children: remapContainerRefs(node.children, idMap),
  }));
}

export interface ElementScope {
  element: NamedElement;
  container: ContainerNode;
}

/** Look up a NamedElement and its container subtree's slot ids — the scope unit for Guardian/chat. */
export function resolveElementScope(content: PageContent, elementId: string): ElementScope | null {
  const element = content.namedElements?.[elementId];
  if (!element || !content.containers) return null;
  for (const node of flattenContainers(content.containers)) {
    if (node.id === element.containerId) return { element, container: node };
  }
  return null;
}
