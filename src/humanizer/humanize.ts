import { getStyleGuideStore } from '../storage/style-guides.js';
import { getHumanizerConfigStore } from '../storage/humanizer-config.js';
import { composeStyleContext } from '../design/design-excellence.js';
import { callAi, stripCodeFences } from './ai-call.js';
import {
  buildHumanizerPrompt,
  buildUserMessage,
  SIMPLE_HUMANIZE_PROMPT,
} from './build-prompt.js';
import type { HumanizeOptions, HumanizeResult, HumanizerMode, HumanizerReview } from './types.js';

function parseSkillResponse(raw: string, fallbackHtml: string): HumanizeResult {
  const cleaned = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(cleaned) as {
      humanizedHtml?: string;
      review?: HumanizerReview;
    };
    if (parsed.humanizedHtml) {
      return {
        humanizedHtml: parsed.humanizedHtml,
        mode: 'skill',
        review: parsed.review,
      };
    }
  } catch {
    // not JSON — treat as raw HTML
  }
  if (cleaned.includes('<') && cleaned.includes('>')) {
    return { humanizedHtml: cleaned, mode: 'skill' };
  }
  return { humanizedHtml: fallbackHtml, mode: 'skill' };
}

async function resolveMode(siteId: string, mode?: HumanizerMode): Promise<HumanizerMode> {
  if (mode) return mode;
  const store = await getHumanizerConfigStore();
  const site = await store.getSiteConfig(siteId);
  const workspace = await store.getWorkspaceDefaults();
  return site?.mode ?? workspace.defaultMode ?? 'simple';
}

/**
 * The style context the humanizer prompt receives for a site. Shared with the
 * prompt-preview endpoint so the preview can never drift from what the real
 * humanize run sends.
 */
export async function resolveStyleAddition(siteId: string): Promise<string | undefined> {
  const styleGuide = await getStyleGuideStore().then((s) => s.get(siteId));
  return styleGuide ? composeStyleContext(styleGuide) : undefined;
}

export async function humanizeHtml(options: HumanizeOptions): Promise<HumanizeResult> {
  const { html, siteId, contentType = 'auto', includeReview = false } = options;
  const mode = await resolveMode(siteId, options.mode);

  // Budgets doubled when callAi gained a truncation THROW (it used to return
  // silently cut-off HTML): a long post must fit, because overflowing is now
  // a loud failure instead of a quietly truncated save.
  if (mode === 'simple') {
    const text = await callAi(SIMPLE_HUMANIZE_PROMPT, html, 8192);
    return { humanizedHtml: stripCodeFences(text) || html, mode: 'simple' };
  }

  const configStore = await getHumanizerConfigStore();
  const config = await configStore.getOrCreateSiteConfig(siteId);
  const styleAddition = await resolveStyleAddition(siteId);

  const resolvedType =
    contentType === 'auto' ? config.contentTypeHint ?? 'auto' : contentType;

  const system = await buildHumanizerPrompt({
    config,
    contentType: resolvedType,
    includeReview,
    styleGuideAddition: styleAddition,
  });

  const user = buildUserMessage(html, includeReview);
  const maxTokens = includeReview ? 16384 : 8192;
  const raw = await callAi(system, user, maxTokens);
  return parseSkillResponse(raw, html);
}

/** @deprecated Use humanizeHtml({ html, siteId }) — kept for backward compat */
export async function humanizeHtmlLegacy(html: string): Promise<string> {
  const result = await humanizeHtml({ html, siteId: '_legacy', mode: 'simple' });
  return result.humanizedHtml;
}
