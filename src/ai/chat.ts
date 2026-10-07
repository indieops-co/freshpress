import type { ContentSlot, ElementCustomCssChange, ElementStyleChange, ElementStyleOverrides, PageContent, SlotChange } from '../content/types.js';
import { copyExcellence } from '../design/design-excellence.js';
import { callAiJson, extractJsonValue } from './call-json.js';

/** Element scope handed to the AI when chat is confined to one named element's subtree (Chunk 3). */
export interface ChatScopeContext {
  elementId: string;
  elementType: string;
  /** Slot ids inside the scoped element's subtree — the only slots the AI may reference */
  slotIds: string[];
  /** Valid token names per whitelisted style property, from the site's StyleGuide */
  styleTokens: {
    padding: string[];
    margin: string[];
    radius: string[];
    shadow: string[];
    color: string[];
  };
  currentStyleOverrides?: ElementStyleOverrides;
  currentCustomCss?: string;
}

export interface ChatRequest {
  message: string;
  content: PageContent;
  pageTitle?: string;
  styleContext?: string;
  scope?: ChatScopeContext;
}

export interface ChatResponse {
  changes: SlotChange[];
  styleChanges?: ElementStyleChange[];
  customCssChange?: ElementCustomCssChange;
  explanation: string;
  provider: 'anthropic' | 'openrouter';
}

const BASE_SYSTEM_PROMPT = `You are a content editor assistant for a locked-template CMS.
You MUST NOT write HTML, CSS, JavaScript, or code of any kind via the content-slot path.
You only propose content slot value changes as JSON.

Each page has content slots with id, type (text|image|link|button), and current value.
Respond with ONLY valid JSON in this shape:
{
  "explanation": "brief plain-English summary of what you changed",
  "changes": [
    { "slotId": "...", "value": "new text", "href": "optional for links", "alt": "optional for images" }
  ]
}

Rules:
- Only modify slots that exist in the provided slot list.
- Never empty heading (h1-h6) slots.
- Never remove slots or add new ones.
- Keep changes minimal and faithful to the user's request.
- For link slots, include href when changing the destination.
- Only include "styleChanges" or "customCssChange" fields in your response if a scoped-element
  section appears below granting them — if no such section appears, restyling isn't available
  for this request and both fields must be omitted entirely.`;

export function buildSystemPrompt(styleContext?: string, scope?: ChatScopeContext): string {
  let prompt = `${BASE_SYSTEM_PROMPT}\n\n${copyExcellence()}`;
  if (styleContext?.trim()) {
    prompt += `\n\nSite design direction:\n${styleContext.trim()}`;
  }
  if (scope) {
    prompt += `\n\n${buildScopePrompt(scope)}`;
  }
  return prompt;
}

function buildScopePrompt(scope: ChatScopeContext): string {
  return `You are scoped to element "${scope.elementId}" (${scope.elementType}) and its nested children only.
Do not propose slot changes for slots outside this element's subtree, and never reference an elementId in
styleChanges/customCssChange other than "${scope.elementId}" or one of its descendants.

You may ALSO propose whitelisted style changes for this element (or a nested named element within it),
using ONLY these existing design tokens — never raw CSS, hex colors, or px values here:
- padding/margin tokens: ${scope.styleTokens.padding.join(', ') || '(none configured)'}
- radius tokens: ${scope.styleTokens.radius.join(', ') || '(none configured)'}
- shadow tokens: ${scope.styleTokens.shadow.join(', ') || '(none configured)'}
- background/textColor tokens: ${scope.styleTokens.color.join(', ') || '(none configured)'}
Add to the JSON response: "styleChanges": [ { "elementId": "...", "padding": "lg", "radius": "md" } ] —
only when the user actually asked to change appearance, and only include the properties being changed.
${scope.currentStyleOverrides ? `Current style overrides on this element: ${JSON.stringify(scope.currentStyleOverrides)}` : ''}

Only if the user's message EXPLICITLY asks for custom/raw CSS (not a normal style tweak), you may
instead or additionally add: "customCssChange": { "elementId": "...", "customCss": "property: value; property2: value2;" }
customCss must be a plain declaration list only — no selectors, braces, @rules, or url(). This is an
advanced escape hatch, not the default path — prefer styleChanges whenever a token covers the request.
${scope.currentCustomCss ? `Current custom CSS on this element: ${scope.currentCustomCss}` : ''}`;
}

export function buildUserPrompt(req: ChatRequest): string {
  const slotIds = req.scope
    ? req.content.slotOrder.filter((id) => req.scope!.slotIds.includes(id))
    : req.content.slotOrder;

  const slotSummary = slotIds
    .map((id) => {
      const s = req.content.slots[id];
      const extras =
        s.type === 'link' ? ` href="${s.href ?? ''}"` : s.type === 'image' ? ` alt="${s.alt ?? ''}"` : '';
      return `- ${id} (${s.type}, <${s.tag}>): "${s.value}"${extras}`;
    })
    .join('\n');

  return `Page: ${req.pageTitle ?? 'Untitled'}

Current slots:
${slotSummary}

User request: ${req.message}`;
}

export interface AiCredentials {
  provider: 'anthropic' | 'openrouter';
  apiKey: string;
  model?: string;
}

/** Explicit credentials, else env fallback — the shared shape callAiJson consumes. */
function resolveCredentials(credentials?: AiCredentials | null): AiCredentials {
  if (credentials) return credentials;
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  if (process.env.OPENROUTER_API_KEY) return { provider: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY };
  throw new Error(
    'No AI provider configured — add keys in Admin → AI Providers or set ANTHROPIC_API_KEY / OPENROUTER_API_KEY'
  );
}

export async function proposeChanges(
  req: ChatRequest,
  credentials?: AiCredentials | null
): Promise<ChatResponse> {
  const creds = resolveCredentials(credentials);
  const text = await callAiJson(buildSystemPrompt(req.styleContext, req.scope), buildUserPrompt(req), creds);
  return parseAiJson(text, creds.provider);
}

function parseAiJson(text: string, provider: 'anthropic' | 'openrouter'): ChatResponse {
  const value = extractJsonValue(text, 'object');
  if (!value || typeof value !== 'object') {
    throw new Error('AI did not return valid JSON');
  }

  const parsed = value as {
    explanation?: string;
    changes?: SlotChange[];
    styleChanges?: ElementStyleChange[];
    customCssChange?: ElementCustomCssChange;
  };

  const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
  const styleChanges = Array.isArray(parsed.styleChanges) && parsed.styleChanges.length > 0 ? parsed.styleChanges : undefined;
  const customCssChange = parsed.customCssChange;

  if (changes.length === 0 && !styleChanges && !customCssChange) {
    throw new Error('AI returned no changes');
  }

  return {
    changes,
    ...(styleChanges ? { styleChanges } : {}),
    ...(customCssChange ? { customCssChange } : {}),
    explanation: parsed.explanation ?? 'Changes proposed',
    provider,
  };
}
