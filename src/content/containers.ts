import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { ContainerNode, PageContent } from './types.js';

/**
 * Heuristic container derivation for ingested/legacy pages.
 *
 * Parses the frozen template and builds a tree of structural containers:
 * semantic landmarks (header/nav/footer/aside/main/section/article/form) plus
 * repeated-sibling groups (>=2 same-tag same-class element children → a grid
 * whose children are cards). Slot placeholders replaced at ingest time were
 * only ever a/button/input/img elements, so container-tag sibling indexes in
 * the template match the pre-replacement paths stored on slots — path-prefix
 * matching between the two is reliable.
 *
 * Generated pages (Chunk 8) skip this entirely: the generator emits
 * authoritative containers and named elements directly.
 */

const LANDMARK_TYPES: Record<string, string> = {
  header: 'Header',
  nav: 'Nav',
  footer: 'Footer',
  aside: 'Sidebar',
  form: 'Form',
  main: 'Section',
  section: 'Section',
  article: 'Section',
};

const CONTAINER_TAGS = new Set([...Object.keys(LANDMARK_TYPES), 'div']);

const MIN_REPEATED_SIBLINGS = 2;

export function deriveContainers(content: PageContent): ContainerNode[] {
  const $ = cheerio.load(content.template);
  const body = $('body').get(0);
  if (!body) return [];

  const children = buildChildren($, body, '', content);

  const root: ContainerNode = {
    id: 'page-root',
    path: '',
    tag: 'body',
    suggestedType: 'Page',
    slotIds: directSlotIds(content, '', children),
    children,
  };

  markHeroSection(root, content);
  return [root];
}

/** Recursively find container children of `el`, keyed by ingest-format paths. */
function buildChildren(
  $: cheerio.CheerioAPI,
  el: Element,
  parentPath: string,
  content: PageContent
): ContainerNode[] {
  const result: ContainerNode[] = [];
  const elementChildren = $(el).children().toArray();

  const repeatedGroups = findRepeatedGroups($, elementChildren);

  for (const child of elementChildren) {
    const tag = child.tagName?.toLowerCase();
    if (!tag) continue;
    const path = childPath($, child, tag, parentPath);
    const group = repeatedGroups.get(child);

    if (isContainer(tag, group !== undefined)) {
      const grandchildren = buildChildren($, child, path, content);
      const node: ContainerNode = {
        id: containerId(path),
        path,
        tag,
        suggestedType: suggestType(tag, group !== undefined),
        slotIds: directSlotIds(content, path, grandchildren),
        children: grandchildren,
      };
      // Only keep containers that carry structure: slots, children, or a landmark/repeated role.
      if (node.slotIds.length > 0 || node.children.length > 0 || tag !== 'div' || group !== undefined) {
        result.push(node);
        continue;
      }
    }

    // Non-container (or empty div): recurse transparently so nested landmarks surface.
    result.push(...buildChildren($, child, path, content));
  }

  return typeRepeatedParents(result, content);
}

/** Children appearing >=MIN_REPEATED_SIBLINGS times with same tag+class → repeated group members. */
function findRepeatedGroups($: cheerio.CheerioAPI, children: Element[]): Map<Element, string> {
  const signatureCounts = new Map<string, Element[]>();
  for (const child of children) {
    const tag = child.tagName?.toLowerCase();
    if (!tag || !CONTAINER_TAGS.has(tag)) continue;
    const signature = `${tag}|${($(child).attr('class') ?? '').trim()}`;
    const list = signatureCounts.get(signature) ?? [];
    list.push(child);
    signatureCounts.set(signature, list);
  }

  const members = new Map<Element, string>();
  for (const [signature, list] of signatureCounts) {
    if (list.length >= MIN_REPEATED_SIBLINGS) {
      for (const el of list) members.set(el, signature);
    }
  }
  return members;
}

function isContainer(tag: string, isRepeated: boolean): boolean {
  if (tag in LANDMARK_TYPES) return true;
  return tag === 'div' && isRepeated;
}

function suggestType(tag: string, isRepeated: boolean): string | undefined {
  // Landmarks keep their semantic role even when repeated (e.g. sibling
  // <section>s are Sections, not cards); only repeated divs read as cards.
  if (tag in LANDMARK_TYPES) return LANDMARK_TYPES[tag];
  if (isRepeated) return 'InfoCard';
  return undefined;
}

/** Parents whose container children are all InfoCards become FeatureGrid (or Gallery when image-led). */
function typeRepeatedParents(nodes: ContainerNode[], content: PageContent): ContainerNode[] {
  for (const node of nodes) {
    const cardChildren = node.children.filter((c) => c.suggestedType === 'InfoCard');
    if (cardChildren.length >= MIN_REPEATED_SIBLINGS) {
      const imageLed =
        cardChildren.filter((c) => subtreeSlotIds(c).some((id) => content.slots[id]?.type === 'image'))
          .length > cardChildren.length / 2;
      node.suggestedType = imageLed ? 'Gallery' : 'FeatureGrid';
    }
  }
  return nodes;
}

/** First top-level Section containing an h1 slot becomes the HeroSection. */
function markHeroSection(root: ContainerNode, content: PageContent): void {
  for (const node of root.children) {
    if (node.suggestedType !== 'Section') continue;
    const hasH1 = subtreeSlotIds(node).some((id) => content.slots[id]?.tag === 'h1');
    if (hasH1) {
      node.suggestedType = 'HeroSection';
      return;
    }
  }
}

/** Path-segment format shared by childPath() (builds) and resolvePathElement() (parses): tag[index]. */
const PATH_SEGMENT_RE = /^(.+)\[(\d+)\]$/;
function formatPathSegment(tag: string, index: number): string {
  return `${tag}[${index}]`;
}

function childPath($: cheerio.CheerioAPI, child: Element, tag: string, parentPath: string): string {
  const parent = child.parent as Element | null;
  const sameTagSiblings = parent ? $(parent).children(tag).toArray() : [child];
  const index = sameTagSiblings.indexOf(child);
  const segment = formatPathSegment(tag, index);
  return parentPath ? `${parentPath}>${segment}` : segment;
}

/** Stable container id from a DOM path. Exported so the generator (Chunk 8) stamps identical ids. */
export function containerId(path: string): string {
  return `c-${path.replace(/[^a-z0-9[\]>-]/gi, '').replace(/>/g, '-').replace(/[[\]]/g, '')}`;
}

/** Slots under `path` that are not claimed by any child container's subtree. */
function directSlotIds(content: PageContent, path: string, children: ContainerNode[]): string[] {
  const childPrefixes = children.map((c) => c.path);
  return content.slotOrder.filter((slotId) => {
    const slot = content.slots[slotId];
    if (!slot) return false;
    if (!isUnderPath(slot.path, path)) return false;
    return !childPrefixes.some((prefix) => isUnderPath(slot.path, prefix));
  });
}

/** True when `path` is `containerPath` itself or nested inside it (a slot path or a nested container's path). */
export function isUnderPath(path: string, containerPath: string): boolean {
  if (containerPath === '') return true;
  return path === containerPath || path.startsWith(`${containerPath}>`);
}

export function subtreeSlotIds(node: ContainerNode): string[] {
  return [...node.slotIds, ...node.children.flatMap(subtreeSlotIds)];
}

/** Depth-first flatten of a container tree. */
export function flattenContainers(nodes: ContainerNode[]): ContainerNode[] {
  return nodes.flatMap((n) => [n, ...flattenContainers(n.children)]);
}

/** Find a container by id anywhere in the tree. */
export function findContainer(nodes: ContainerNode[], containerId: string): ContainerNode | null {
  for (const node of flattenContainers(nodes)) {
    if (node.id === containerId) return node;
  }
  return null;
}

/**
 * Stamp `data-element-id` onto each named container's wrapper element in the frozen template —
 * the DOM hook Chunk 4's sidebar/click-highlight and Amendment A's CSS overrides both select on.
 * Resolves each node's `path` the same way `childPath()` computed it during derivation
 * (same-tag sibling indexing), so it must run against the template before slot substitution.
 */
export function injectElementIds(template: string, containers: ContainerNode[]): string {
  const nodes = flattenContainers(containers);
  if (!nodes.some((n) => n.elementId)) return template;

  const $ = cheerio.load(template);
  const body = $('body').get(0);
  if (!body) return template;

  for (const node of nodes) {
    if (!node.elementId) continue;
    const el = resolvePathElement($, body, node.path);
    if (el) $(el).attr('data-element-id', node.elementId);
  }

  return $.html();
}

/** Reverse of childPath(): walk a `tag[i]>tag[j]…` path down from `root` to the element it names. */
function resolvePathElement($: cheerio.CheerioAPI, root: Element, path: string): Element | null {
  if (path === '') return root;

  let current: Element = root;
  for (const segment of path.split('>')) {
    const match = PATH_SEGMENT_RE.exec(segment);
    if (!match) return null;
    const [, tag, indexStr] = match;
    const next = $(current).children(tag).get(Number(indexStr));
    if (!next) return null;
    current = next;
  }
  return current;
}
