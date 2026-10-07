import { z } from 'zod';
import type {
  ContentSlot,
  ElementCustomCssChange,
  ElementStyleChange,
  ElementStyleOverrides,
  GuardianResult,
  NamedElement,
  PageContent,
  SlotChange,
} from '../content/types.js';
import { applySlotChanges } from '../content/render.js';
import { extractTemplateSlotIds } from '../ingest/index.js';
import { resolveElementScope, type ElementScope } from '../content/named-elements.js';
import { isUnderPath } from '../content/containers.js';
import { validateCustomCss } from './validate-css.js';
import { styleTokenMaps, type StyleGuide } from '../design/style-guide.js';

const SlotChangeSchema = z.object({
  slotId: z.string().min(1),
  value: z.string().optional(),
  href: z.string().optional(),
  alt: z.string().optional(),
});

const ChangesSchema = z.array(SlotChangeSchema).min(1);

const ElementStyleChangeSchema = z.object({
  elementId: z.string().min(1),
  padding: z.string().optional(),
  margin: z.string().optional(),
  radius: z.string().optional(),
  shadow: z.string().optional(),
  background: z.string().optional(),
  textColor: z.string().optional(),
});

const ElementStyleChangesSchema = z.array(ElementStyleChangeSchema).min(1);

const ElementCustomCssChangeSchema = z.object({
  elementId: z.string().min(1),
  customCss: z.string().min(1),
});

const ElementCustomCssChangesSchema = z.array(ElementCustomCssChangeSchema).min(1);

/** Dangerous patterns that must never appear in slot values (shared with validate-generated-page's template check). */
export const SCRIPT_PATTERN = /<script\b|javascript:|on\w+\s*=/i;
const TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

/**
 * The Guardian — deterministic validator (no AI).
 * Rejects malformed changes and anything that would remove structural sections.
 */
export function validateChanges(
  content: PageContent,
  changes: SlotChange[],
  allowedSlotIds?: Set<string>
): GuardianResult {
  const errors: string[] = [];

  const parsed = ChangesSchema.safeParse(changes);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.errors.map((e) => e.message) };
  }

  const templateSlotIds = new Set(extractTemplateSlotIds(content));
  const patch: Record<string, Partial<Pick<ContentSlot, 'value' | 'href' | 'alt'>>> = {};

  for (const change of parsed.data) {
    const slot = content.slots[change.slotId];
    if (!slot) {
      errors.push(`Unknown slot: ${change.slotId}`);
      continue;
    }
    if (!templateSlotIds.has(change.slotId)) {
      errors.push(`Slot ${change.slotId} is not in the frozen template`);
      continue;
    }
    if (allowedSlotIds && !allowedSlotIds.has(change.slotId)) {
      errors.push(`Slot ${change.slotId} is outside the scoped element's subtree`);
      continue;
    }

    const slotErrors = validateSingleChange(slot, change);
    errors.push(...slotErrors);

    if (slotErrors.length === 0) {
      patch[change.slotId] = {
        ...(change.value !== undefined ? { value: change.value } : {}),
        ...(change.href !== undefined ? { href: change.href } : {}),
        ...(change.alt !== undefined ? { alt: change.alt } : {}),
      };
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const next = applySlotChanges(content, patch);
  const sectionErrors = validateStructuralIntegrity(content, next);
  if (sectionErrors.length > 0) {
    return { ok: false, errors: sectionErrors };
  }

  return { ok: true, errors: [], applied: next.slots };
}

function validateSingleChange(slot: ContentSlot, change: SlotChange): string[] {
  const errors: string[] = [];

  if (change.value !== undefined) {
    if (typeof change.value !== 'string') {
      errors.push(`Slot ${change.slotId}: value must be a string`);
    } else if (SCRIPT_PATTERN.test(change.value)) {
      errors.push(`Slot ${change.slotId}: value contains disallowed script content`);
    } else if (slot.type !== 'text' && TAG_PATTERN.test(change.value)) {
      errors.push(`Slot ${change.slotId}: HTML tags are not allowed in ${slot.type} values`);
    } else if (slot.type === 'text' && TAG_PATTERN.test(change.value)) {
      errors.push(`Slot ${change.slotId}: raw HTML is not allowed in text slots`);
    } else if (isStructuralSlot(slot) && change.value.trim().length === 0) {
      errors.push(`Slot ${change.slotId}: cannot empty a structural text slot`);
    }
  }

  if (change.href !== undefined) {
    if (slot.type !== 'link') {
      errors.push(`Slot ${change.slotId}: href is only valid for link slots`);
    } else if (!isValidHref(change.href)) {
      errors.push(`Slot ${change.slotId}: invalid href "${change.href}"`);
    }
  }

  if (change.alt !== undefined && slot.type !== 'image') {
    errors.push(`Slot ${change.slotId}: alt is only valid for image slots`);
  }

  if (change.value === undefined && change.href === undefined && change.alt === undefined) {
    errors.push(`Slot ${change.slotId}: no changes provided`);
  }

  return errors;
}

/** Structural slots are headings and primary section labels — must not be emptied */
function isStructuralSlot(slot: ContentSlot): boolean {
  return /^h[1-6]$/.test(slot.tag) || slot.path.split('>').length <= 2;
}

function isValidHref(href: string): boolean {
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return true;
  }
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Ensure no template slot loses its content or disappears */
function validateStructuralIntegrity(before: PageContent, after: PageContent): string[] {
  const errors: string[] = [];
  const templateIds = extractTemplateSlotIds(before);

  for (const id of templateIds) {
    const prev = before.slots[id];
    const next = after.slots[id];

    if (!next) {
      errors.push(`Structural violation: slot ${id} was removed`);
      continue;
    }

    if (prev && isStructuralSlot(prev) && next.value.trim().length === 0) {
      errors.push(`Structural violation: slot ${id} (${prev.tag}) cannot be emptied`);
    }
  }

  if (after.slotOrder.length !== before.slotOrder.length) {
    errors.push('Structural violation: slot order changed — sections cannot be removed');
  }

  return errors;
}

export function mergeValidatedSlots(
  content: PageContent,
  applied: Record<string, ContentSlot>
): PageContent {
  return { ...content, slots: { ...content.slots, ...applied } };
}

/**
 * Resolve `elementId` as a target within `scope`'s subtree — either `scope` itself or a nested
 * named element (e.g. one card inside a scoped grid). Returns an error string when the element
 * is unknown or falls outside the scope's confinement boundary.
 */
function resolveScopedTarget(
  content: PageContent,
  scope: ElementScope,
  scopeElementId: string,
  elementId: string
): ElementScope | { error: string } {
  const target = elementId === scopeElementId ? scope : resolveElementScope(content, elementId);
  if (!target || !isUnderPath(target.container.path, scope.container.path)) {
    return { error: `Element ${elementId} is outside the scoped element ${scopeElementId}'s subtree` };
  }
  return target;
}

export interface ElementStyleGuardianResult {
  ok: boolean;
  errors: string[];
  /** Keyed by elementId — merges onto NamedElement.styleOverrides */
  appliedStyleOverrides?: Record<string, ElementStyleOverrides>;
}

/**
 * Validates AI-proposed structured style changes against the site's StyleGuide token whitelist,
 * confined to `scopeElementId`'s subtree (a change may target a nested named element, e.g. one
 * card inside a scoped grid, but never an element outside the subtree).
 */
export function validateElementStyleChanges(
  content: PageContent,
  styleGuide: StyleGuide | undefined,
  scopeElementId: string,
  changes: ElementStyleChange[]
): ElementStyleGuardianResult {
  const scope = resolveElementScope(content, scopeElementId);
  if (!scope) return { ok: false, errors: [`Unknown scoped element: ${scopeElementId}`] };

  const parsed = ElementStyleChangesSchema.safeParse(changes);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.errors.map((e) => e.message) };
  }
  if (!styleGuide) {
    return { ok: false, errors: ['No StyleGuide configured for this site — style changes require one'] };
  }

  const tokenMaps = styleTokenMaps(styleGuide);
  const errors: string[] = [];
  const appliedStyleOverrides: Record<string, ElementStyleOverrides> = {};

  for (const change of parsed.data) {
    const target = resolveScopedTarget(content, scope, scopeElementId, change.elementId);
    if ('error' in target) {
      errors.push(target.error);
      continue;
    }

    const patch: ElementStyleOverrides = {};
    for (const prop of Object.keys(tokenMaps) as (keyof ElementStyleOverrides)[]) {
      const value = change[prop];
      if (value === undefined) continue;
      if (!(value in tokenMaps[prop])) {
        errors.push(`Element ${change.elementId}: "${value}" is not a valid ${prop} token`);
        continue;
      }
      patch[prop] = value;
    }

    if (Object.keys(patch).length === 0) {
      errors.push(`Element ${change.elementId}: no recognized style properties in change`);
      continue;
    }

    appliedStyleOverrides[change.elementId] = {
      ...target.element.styleOverrides,
      ...appliedStyleOverrides[change.elementId],
      ...patch,
    };
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], appliedStyleOverrides };
}

export interface ElementCssGuardianResult {
  ok: boolean;
  errors: string[];
  /** Keyed by elementId — merges onto NamedElement.customCss */
  appliedCustomCss?: Record<string, string>;
}

/**
 * Validates the raw-CSS escape hatch for one or more elements within `scopeElementId`'s subtree.
 * Separate, explicitly-gated channel from validateElementStyleChanges — never folded into it.
 */
export function validateElementCustomCss(
  content: PageContent,
  scopeElementId: string,
  changes: ElementCustomCssChange[]
): ElementCssGuardianResult {
  const scope = resolveElementScope(content, scopeElementId);
  if (!scope) return { ok: false, errors: [`Unknown scoped element: ${scopeElementId}`] };

  const parsed = ElementCustomCssChangesSchema.safeParse(changes);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.errors.map((e) => e.message) };
  }

  const errors: string[] = [];
  const appliedCustomCss: Record<string, string> = {};

  for (const change of parsed.data) {
    const target = resolveScopedTarget(content, scope, scopeElementId, change.elementId);
    if ('error' in target) {
      errors.push(target.error);
      continue;
    }

    const cssErrors = validateCustomCss(change.customCss);
    if (cssErrors.length > 0) {
      errors.push(...cssErrors.map((e) => `Element ${change.elementId}: ${e}`));
      continue;
    }

    appliedCustomCss[change.elementId] = change.customCss;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], appliedCustomCss };
}

/** Merge validated element-scoped style/CSS patches onto PageContent.namedElements (immutable). */
export function mergeValidatedElementOverrides(
  content: PageContent,
  patch: {
    styleOverrides?: Record<string, ElementStyleOverrides>;
    customCss?: Record<string, string>;
  }
): PageContent {
  if (!content.namedElements) return content;
  const namedElements: Record<string, NamedElement> = { ...content.namedElements };

  for (const [elementId, overrides] of Object.entries(patch.styleOverrides ?? {})) {
    const el = namedElements[elementId];
    if (!el) continue;
    namedElements[elementId] = { ...el, styleOverrides: { ...el.styleOverrides, ...overrides } };
  }

  for (const [elementId, customCss] of Object.entries(patch.customCss ?? {})) {
    const el = namedElements[elementId];
    if (!el) continue;
    namedElements[elementId] = { ...el, customCss };
  }

  return { ...content, namedElements };
}
