/**
 * Site-wide theme chat (Chunk 5 / Amendment E, open-question #1: a NEW site-scoped
 * endpoint, distinct from the per-page content chat in `chat.ts`). Turns "make InfoCard
 * corners rounder" into a proposed partial-`StyleGuide` patch — the site's design tokens,
 * not one page instance. The returned patch is always run through
 * `validateStyleGuideChange` before it is applied, so this chat and the structured JSON
 * panel share one validated write path and cannot drift apart.
 */
import type { StyleGuide } from '../design/style-guide.js';
import { PALETTE_DISCIPLINE } from '../design/design-excellence.js';
import { editableSurfaceForScope, type EditableFieldInfo } from '../guardian/validate-style-guide.js';
import type { AiCredentials } from './chat.js';
import { callAiJson, extractJsonValue } from './call-json.js';

export interface StyleChatScope {
  /** The specimen / taxonomy type the user clicked ("InfoCard", "Button · Primary", …). */
  elementType?: string;
}

export interface StyleChatRequest {
  message: string;
  guide: StyleGuide;
  scope?: StyleChatScope;
}

export interface StyleChatResponse {
  /** A deep-partial of StyleGuide — only the leaf fields the AI wants to change. */
  patch: Record<string, unknown>;
  explanation: string;
  provider: 'anthropic' | 'openrouter';
}

function describeKind(field: EditableFieldInfo): string {
  const k = field.kind;
  switch (k.kind) {
    case 'enum':
      return `one of [${k.values.join(' | ')}]`;
    case 'number':
      return 'a number';
    case 'color':
      return 'a CSS color';
    case 'shadow':
      return 'a CSS shadow/border value';
    case 'font':
      return 'a font-family name';
    case 'text':
      return 'plain text';
    case 'css-value':
      return 'a CSS length/value';
    case 'site-css':
      return 'raw CSS';
  }
}

function buildSystemPrompt(guide: StyleGuide, scope?: StyleChatScope): string {
  // Chat proposes token values only — the raw-CSS escape hatch (customCss) is panel-only.
  const fields = editableSurfaceForScope(guide, scope?.elementType).filter((f) => f.kind.kind !== 'site-css');
  const fieldLines = fields
    .map((f) => `- ${f.path} = ${JSON.stringify(f.current)} (${describeKind(f)})`)
    .join('\n');

  const scopeNote = scope?.elementType
    ? `You are focused on the "${scope.elementType}" element type. Prefer changing its own tokens; the
spacing / radii / shadow / type-scale tokens are also editable so a container can grow to fit its
content and text stays legible (never leave an element visually squeezed). Do not touch tokens for
unrelated element types.`
    : `No element is selected — you may edit any field in the list below (the whole site theme).`;

  return `You edit a website's SITE-WIDE design system (its "StyleGuide" tokens). A change here restyles
EVERY instance of the affected element across the whole site — you are NOT editing one page or one
element instance.

${scopeNote}

Respond with ONLY valid JSON in this exact shape:
{
  "explanation": "brief plain-English summary of what you changed",
  "patch": { ...only the changed fields, nested to mirror the StyleGuide shape... }
}

The "patch" is a DEEP-PARTIAL of the StyleGuide: include ONLY the leaf fields you are changing, nested
under their real parents. Example — to round card corners and enlarge the h1:
{ "explanation": "...", "patch": { "components": { "card": { "radius": "20px" } }, "typography": { "scale": { "h1": { "size": "2.75rem" } } } } }

Rules:
- Only set fields that appear in the editable list below. Never invent new fields or paths.
- Use real CSS values (e.g. "20px", "1.25rem", "#6c8cff", "0 4px 12px rgba(0,0,0,0.08)"). Never write
  selectors, braces, @rules, url(), or any code — plain token values only.
- Enum fields must use one of their listed allowed values exactly.
- Keep the patch minimal and faithful to the request; do not restyle things the user didn't ask about.
- When changing colors: ${PALETTE_DISCIPLINE}

Editable fields (path = current value (type)):
${fieldLines}`;
}

function parsePatchJson(text: string, provider: 'anthropic' | 'openrouter'): StyleChatResponse {
  const value = extractJsonValue(text, 'object');
  if (!value || typeof value !== 'object') throw new Error('AI did not return valid JSON');

  const parsed = value as { explanation?: string; patch?: unknown };
  if (!parsed.patch || typeof parsed.patch !== 'object' || Array.isArray(parsed.patch)) {
    throw new Error('AI returned no theme changes');
  }

  return {
    patch: parsed.patch as Record<string, unknown>,
    explanation: parsed.explanation ?? 'Theme changes proposed',
    provider,
  };
}

export async function proposeStyleGuideChange(
  req: StyleChatRequest,
  credentials?: AiCredentials | null
): Promise<StyleChatResponse> {
  const system = buildSystemPrompt(req.guide, req.scope);
  const user = `User request: ${req.message}`;

  const creds: AiCredentials | null =
    credentials ??
    (process.env.ANTHROPIC_API_KEY
      ? { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY }
      : process.env.OPENROUTER_API_KEY
        ? { provider: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY }
        : null);
  if (!creds) {
    throw new Error(
      'No AI provider configured — add keys in Admin → AI Providers or set ANTHROPIC_API_KEY / OPENROUTER_API_KEY'
    );
  }

  const text = await callAiJson(system, user, creds);
  return parsePatchJson(text, creds.provider);
}
