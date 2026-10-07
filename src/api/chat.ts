import { Router } from 'express';
import { getStorage } from '../storage/filesystem.js';
import { proposeChanges, type ChatResponse, type ChatScopeContext } from '../ai/chat.js';
import { composeStyleContext } from '../design/design-excellence.js';
import { resolveAiKeys } from '../integrations/resolve.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import {
  validateChanges,
  mergeValidatedSlots,
  validateElementStyleChanges,
  validateElementCustomCss,
  mergeValidatedElementOverrides,
  type ElementStyleGuardianResult,
  type ElementCssGuardianResult,
} from '../guardian/validate.js';
import { resolveElementScope } from '../content/named-elements.js';
import { subtreeSlotIds } from '../content/containers.js';
import { renderPage } from '../content/render.js';
import { requireSiteAccess } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import type { GuardianResult, PageContent } from '../content/types.js';
import { styleTokenMaps, type StyleGuide } from '../design/style-guide.js';

const router = Router();

const siteAuth = requireSiteAccess(async (siteId) => {
  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  return site?.meta.clientPasswordHash;
});

export type ScopeResolution =
  | { ok: true; scope?: ChatScopeContext }
  | { ok: false; status: number; error: string };

/** Resolve an optional elementId/elementType chat scope into the context the AI and Guardian both need. */
export function resolveScope(
  content: PageContent,
  styleGuide: StyleGuide | undefined,
  elementId?: string,
  elementType?: string
): ScopeResolution {
  if (elementType) {
    // Type-level scoping is a SITE-WIDE StyleGuide token edit, not a per-page instance edit —
    // it lives on its own endpoint (POST /sites/:siteId/design/chat, Chunk 5 / Amendment E).
    // The per-page chat only edits this page's content slots and NamedElement instances.
    return {
      ok: false,
      status: 400,
      error:
        'Type-level scoping (elementType) is edited on the Site Theme page — use POST /sites/:siteId/design/chat, not the per-page chat.',
    };
  }
  if (!elementId) return { ok: true };

  const resolved = resolveElementScope(content, elementId);
  if (!resolved) return { ok: false, status: 404, error: `Unknown element: ${elementId}` };

  const tokenMaps = styleGuide ? styleTokenMaps(styleGuide) : undefined;
  const styleTokens = tokenMaps
    ? {
        padding: Object.keys(tokenMaps.padding),
        margin: Object.keys(tokenMaps.margin),
        radius: Object.keys(tokenMaps.radius),
        shadow: Object.keys(tokenMaps.shadow),
        color: Object.keys(tokenMaps.background),
      }
    : { padding: [], margin: [], radius: [], shadow: [], color: [] };

  return {
    ok: true,
    scope: {
      elementId,
      elementType: resolved.element.type,
      slotIds: subtreeSlotIds(resolved.container),
      styleTokens,
      currentStyleOverrides: resolved.element.styleOverrides,
      currentCustomCss: resolved.element.customCss,
    },
  };
}

export interface ChatTurnOutcome {
  proposal: ChatResponse;
  slot?: GuardianResult;
  style?: ElementStyleGuardianResult;
  customCss?: ElementCssGuardianResult;
}

/**
 * Resolve scope, run the AI proposal, and validate every channel it returned through the
 * Guardian. Channels are independent: a rejected style/customCss change never blocks an
 * otherwise-valid slot change (or vice versa) in the same turn.
 *
 * There is deliberately no "restyle the whole page" bypass phrase here: style/customCss changes
 * always require an explicit elementId. Clearing an active scope to make a page-wide request is a
 * frontend concern (the scope pill's "x to clear", per Amendment E) — the backend never infers
 * scope-widening intent from message text.
 */
async function runChatTurn(
  content: PageContent,
  message: string,
  pageTitle: string | undefined,
  styleGuide: StyleGuide | undefined,
  aiKeys: Awaited<ReturnType<typeof resolveAiKeys>>,
  elementId?: string,
  elementType?: string
): Promise<{ scopeError: { status: number; error: string } } | ChatTurnOutcome> {
  const scopeResult = resolveScope(content, styleGuide, elementId, elementType);
  if (!scopeResult.ok) return { scopeError: { status: scopeResult.status, error: scopeResult.error } };

  const proposal = await proposeChanges(
    {
      message,
      content,
      pageTitle,
      styleContext: styleGuide ? composeStyleContext(styleGuide) : undefined,
      scope: scopeResult.scope,
    },
    aiKeys
  );

  const outcome: ChatTurnOutcome = { proposal };

  if (proposal.changes.length > 0) {
    outcome.slot = validateChanges(
      content,
      proposal.changes,
      scopeResult.scope ? new Set(scopeResult.scope.slotIds) : undefined
    );
  }

  // Style/customCss channels are structurally impossible to apply without a scope — if the AI
  // proposed one anyway (a prompt-following slip), drop it silently rather than failing the turn.
  if (proposal.styleChanges?.length && scopeResult.scope) {
    outcome.style = validateElementStyleChanges(content, styleGuide, scopeResult.scope.elementId, proposal.styleChanges);
  }

  if (proposal.customCssChange && scopeResult.scope) {
    outcome.customCss = validateElementCustomCss(content, scopeResult.scope.elementId, [proposal.customCssChange]);
  }

  return outcome;
}

/** Every channel error, prefixed by which channel it came from — for the response body. */
export function collectErrors(outcome: ChatTurnOutcome): string[] {
  return [
    ...(outcome.slot && !outcome.slot.ok ? outcome.slot.errors : []),
    ...(outcome.style && !outcome.style.ok ? outcome.style.errors.map((e) => `[style] ${e}`) : []),
    ...(outcome.customCss && !outcome.customCss.ok ? outcome.customCss.errors.map((e) => `[customCss] ${e}`) : []),
  ];
}

export function applyPatches(content: PageContent, outcome: ChatTurnOutcome): PageContent {
  let updated = content;
  if (outcome.slot?.ok) updated = mergeValidatedSlots(updated, outcome.slot.applied!);
  if (outcome.style?.ok || outcome.customCss?.ok) {
    updated = mergeValidatedElementOverrides(updated, {
      styleOverrides: outcome.style?.ok ? outcome.style.appliedStyleOverrides : undefined,
      customCss: outcome.customCss?.ok ? outcome.customCss.appliedCustomCss : undefined,
    });
  }
  return updated;
}

/** True when every channel the AI actually proposed validated successfully. */
export function anyProposedChannelFailed(outcome: ChatTurnOutcome): boolean {
  return Boolean((outcome.slot && !outcome.slot.ok) || (outcome.style && !outcome.style.ok) || (outcome.customCss && !outcome.customCss.ok));
}

/** True when nothing validated — the whole turn produced no applicable change. */
export function nothingApplied(outcome: ChatTurnOutcome): boolean {
  return !outcome.slot?.ok && !outcome.style?.ok && !outcome.customCss?.ok;
}

/** Fetch the page, its StyleGuide, and resolved AI keys in parallel — none depends on the others. */
async function loadChatContext(siteId: string, pageId: string) {
  const storage = await getStorage();
  const [page, styleGuide, aiKeys] = await Promise.all([
    storage.getPage(siteId, pageId),
    getStyleGuideStore().then((s) => s.get(siteId)),
    resolveAiKeys(),
  ]);
  return { storage, page, styleGuide: styleGuide ?? undefined, aiKeys };
}

/** Turn plain-English request into Guardian-validated slot/style/customCss changes */
router.post('/sites/:siteId/pages/:pageId/chat', siteAuth, async (req, res) => {
  try {
    const { message, elementId, elementType } = req.body as {
      message?: string;
      elementId?: string;
      elementType?: string;
    };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const siteId = routeParam(req.params.siteId);
    const { storage, page, styleGuide, aiKeys } = await loadChatContext(siteId, routeParam(req.params.pageId));
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const result = await runChatTurn(page.content, message.trim(), page.title, styleGuide, aiKeys, elementId, elementType);
    if ('scopeError' in result) {
      res.status(result.scopeError.status).json({ error: result.scopeError.error });
      return;
    }

    if (nothingApplied(result) && anyProposedChannelFailed(result)) {
      res.status(422).json({
        error: 'Guardian rejected AI proposal',
        explanation: result.proposal.explanation,
        provider: result.proposal.provider,
        guardianErrors: collectErrors(result),
        proposedChanges: result.proposal.changes,
        proposedStyleChanges: result.proposal.styleChanges,
        proposedCustomCssChange: result.proposal.customCssChange,
      });
      return;
    }

    const updatedContent = applyPatches(page.content, result);
    const saved = await storage.upsertPage(siteId, {
      ...page,
      content: updatedContent,
    });

    res.json({
      ok: true,
      explanation: result.proposal.explanation,
      provider: result.proposal.provider,
      changes: result.proposal.changes,
      styleChanges: result.proposal.styleChanges,
      customCssChange: result.proposal.customCssChange,
      warnings: anyProposedChannelFailed(result) ? collectErrors(result) : undefined,
      page: saved,
      html: renderPage(updatedContent, styleGuide),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Chat failed' });
  }
});

/** Preview AI proposal without applying */
router.post('/sites/:siteId/pages/:pageId/chat/preview', siteAuth, async (req, res) => {
  try {
    const { message, elementId, elementType } = req.body as {
      message?: string;
      elementId?: string;
      elementType?: string;
    };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const siteId = routeParam(req.params.siteId);
    const { page, styleGuide, aiKeys } = await loadChatContext(siteId, routeParam(req.params.pageId));
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const result = await runChatTurn(page.content, message.trim(), page.title, styleGuide, aiKeys, elementId, elementType);
    if ('scopeError' in result) {
      res.status(result.scopeError.status).json({ error: result.scopeError.error });
      return;
    }

    res.json({
      explanation: result.proposal.explanation,
      provider: result.proposal.provider,
      changes: result.proposal.changes,
      styleChanges: result.proposal.styleChanges,
      customCssChange: result.proposal.customCssChange,
      guardian: {
        ok: !anyProposedChannelFailed(result),
        errors: collectErrors(result),
        slot: result.slot,
        style: result.style,
        customCss: result.customCss,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Chat preview failed' });
  }
});

export default router;
