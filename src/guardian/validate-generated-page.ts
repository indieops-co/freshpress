/**
 * Chunk 8 (open-question #1) — a focused validator for AI-generated PageContent,
 * mirroring validate-style-guide.ts. A malformed generation must never be
 * persisted, so both generation endpoints write through this. It checks the
 * template/slot/container/namedElement integrity the generator is responsible
 * for — NOT slot-edit shape (that's the Guardian's job for chat edits).
 */
import type { PageContent } from '../content/types.js';
import { SLOT_PLACEHOLDER_PREFIX } from '../content/types.js';
import { flattenContainers, injectElementIds } from '../content/containers.js';
import { parseElementId, formatElementId } from '../content/named-elements.js';
import { validateCustomCss } from './validate-css.js';
import { SCRIPT_PATTERN } from './validate.js';

export interface GeneratedPageValidation {
  ok: boolean;
  errors: string[];
}

const VALID_SLOT_TYPES = new Set(['text', 'image', 'link', 'button']);

/** All `{{slot:id}}` ids referenced in a template. */
function templatePlaceholderIds(template: string): string[] {
  const ids: string[] = [];
  const re = /\{\{slot:([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) ids.push(m[1]);
  return ids;
}

export function validateGeneratedPage(content: PageContent): GeneratedPageValidation {
  const errors: string[] = [];
  const push = (msg: string) => errors.push(msg);

  // ── Template + slots ──
  if (typeof content.template !== 'string' || content.template.trim() === '') {
    push('template must be a non-empty string');
  } else if (SCRIPT_PATTERN.test(content.template)) {
    // Scaffold templates are code-serialized with only class/href attributes,
    // so no legitimate generated page ever trips this — it exists to keep the
    // apply endpoint from persisting a handcrafted script-bearing "generation".
    push('template contains script content (<script, javascript:, or on*= attribute)');
  }
  if (!content.slots || typeof content.slots !== 'object') {
    push('slots must be an object');
    return { ok: false, errors };
  }
  if (!Array.isArray(content.slotOrder)) {
    push('slotOrder must be an array');
    return { ok: false, errors };
  }

  const slotKeys = new Set(Object.keys(content.slots));
  const orderSet = new Set(content.slotOrder);
  if (content.slotOrder.length !== orderSet.size) push('slotOrder contains duplicate ids');
  for (const id of content.slotOrder) {
    if (!slotKeys.has(id)) push(`slotOrder references missing slot "${id}"`);
  }
  for (const id of slotKeys) {
    if (!orderSet.has(id)) push(`slot "${id}" is not in slotOrder`);
  }

  for (const [id, slot] of Object.entries(content.slots)) {
    if (slot.id !== id) push(`slot "${id}" has mismatched id "${slot.id}"`);
    if (!VALID_SLOT_TYPES.has(slot.type)) push(`slot "${id}" has invalid type "${slot.type}"`);
    if (typeof slot.tag !== 'string' || slot.tag === '') push(`slot "${id}" has an empty tag`);
    if (typeof slot.value !== 'string') push(`slot "${id}" value must be a string`);
  }

  // ── Placeholder ⇄ slot correspondence ──
  if (typeof content.template === 'string' && content.template.includes(SLOT_PLACEHOLDER_PREFIX)) {
    const placeholderIds = templatePlaceholderIds(content.template);
    const placeholderSet = new Set(placeholderIds);
    if (placeholderIds.length !== placeholderSet.size) push('template contains duplicate slot placeholders');
    for (const id of placeholderSet) {
      if (!slotKeys.has(id)) push(`template references slot "${id}" with no matching slot`);
    }
    for (const id of slotKeys) {
      if (!placeholderSet.has(id)) push(`slot "${id}" has no {{slot:${id}}} placeholder in the template`);
    }
  } else if (slotKeys.size > 0) {
    push('template has no slot placeholders but slots are defined');
  }

  // ── Containers + named elements (authoritative for a generated page) ──
  if (!content.containers || content.containers.length === 0) {
    push('a generated page must carry containers');
  }
  if (!content.namedElements || Object.keys(content.namedElements).length === 0) {
    push('a generated page must carry namedElements');
  }

  if (content.containers && content.namedElements) {
    const flat = flattenContainers(content.containers);
    const containerById = new Map(flat.map((c) => [c.id, c]));
    const elements = content.namedElements;

    const seenTypeIndex = new Set<string>();
    for (const [id, el] of Object.entries(elements)) {
      if (el.id !== id) push(`namedElement "${id}" has mismatched id "${el.id}"`);
      if (el.source !== 'generated') push(`namedElement "${id}" must have source "generated" (got "${el.source}")`);
      if (!parseElementId(id)) push(`namedElement id "${id}" is not well-formed ({Type}-{index}-p{page})`);
      // The fields must round-trip to the id: save-time -pN reconciliation
      // (reconcilePageNumbers) rebuilds ids FROM type/index/pageNumber, so
      // fields that disagree with the id would corrupt or collide after a
      // renumber even though the ids themselves looked fine here.
      if (
        typeof el.type !== 'string' ||
        el.type === '' ||
        !Number.isInteger(el.index) ||
        el.index < 1 ||
        !Number.isInteger(el.pageNumber) ||
        el.pageNumber < 1
      ) {
        push(`namedElement "${id}" has malformed type/index/pageNumber fields`);
      } else {
        if (formatElementId(el.type, el.index, el.pageNumber) !== id) {
          push(`namedElement "${id}" fields do not round-trip to its id (got "${formatElementId(el.type, el.index, el.pageNumber)}")`);
        }
        const typeIndex = `${el.type}#${el.index}`;
        if (seenTypeIndex.has(typeIndex)) {
          push(`namedElement "${id}" duplicates (type, index) "${el.type}", ${el.index} — ids would collide on renumber`);
        }
        seenTypeIndex.add(typeIndex);
      }
      if (el.customCss !== undefined) {
        if (typeof el.customCss !== 'string') push(`namedElement "${id}" customCss must be a string`);
        else validateCustomCss(el.customCss).forEach((e) => push(`namedElement "${id}" customCss: ${e}`));
      }
      const container = containerById.get(el.containerId);
      if (!container) push(`namedElement "${id}" references missing container "${el.containerId}"`);
      else if (container.elementId !== id) push(`container "${el.containerId}" does not back-reference namedElement "${id}"`);
    }

    // Every typed container should have been allocated an element (nothing silently unnamed).
    for (const c of flat) {
      if (c.suggestedType && !c.elementId) push(`container "${c.id}" (${c.suggestedType}) has no allocated namedElement`);
      if (c.elementId && !elements[c.elementId]) push(`container "${c.id}" references missing namedElement "${c.elementId}"`);
    }

    // Strongest check: every element's container path must actually resolve in the template,
    // i.e. injectElementIds stamps it. Catches any path/structure drift the generator produced.
    if (typeof content.template === 'string') {
      const injected = injectElementIds(content.template, content.containers);
      for (const el of Object.values(elements)) {
        if (!injected.includes(`data-element-id="${el.id}"`)) {
          push(`namedElement "${el.id}" container path did not resolve in the template (unstampable)`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
