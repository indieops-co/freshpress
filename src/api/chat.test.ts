import { describe, expect, it } from 'vitest';
import { ingestHtml } from '../ingest/index.js';
import { deriveNamedElements } from '../content/named-elements.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';
import { validateChanges, validateElementStyleChanges } from '../guardian/validate.js';
import {
  resolveScope,
  collectErrors,
  applyPatches,
  anyProposedChannelFailed,
  nothingApplied,
  type ChatTurnOutcome,
} from './chat.js';

const CARDS_HTML = `<!DOCTYPE html>
<html><head><title>Acme Plumbing</title></head>
<body>
  <header><h2>Acme</h2></header>
  <section>
    <h1>Fast, friendly plumbing</h1>
    <p>Serving the metro area since 1998.</p>
  </section>
  <section>
    <div class="cards">
      <div class="card"><h3>Repairs</h3><p>Leaks fixed fast.</p></div>
      <div class="card"><h3>Installs</h3><p>New fixtures done right.</p></div>
      <div class="card"><h3>Emergency</h3><p>24/7 call-out.</p></div>
    </div>
  </section>
  <footer><p>© Acme Plumbing</p></footer>
</body></html>`;

function ingestCardsPage() {
  const { content } = ingestHtml('https://acme.example/', CARDS_HTML);
  return deriveNamedElements(content, 1);
}

describe('resolveScope', () => {
  it('returns ok with no scope when neither elementId nor elementType is given', () => {
    const content = ingestCardsPage();
    const result = resolveScope(content, undefined);
    expect(result).toEqual({ ok: true, scope: undefined });
  });

  it('redirects elementType to the Site Theme endpoint (site-wide token edit, not per-page)', () => {
    const content = ingestCardsPage();
    const result = resolveScope(content, undefined, undefined, 'InfoCard');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('/design/chat');
    }
  });

  it('returns 404 for an unknown elementId', () => {
    const content = ingestCardsPage();
    const result = resolveScope(content, undefined, 'InfoCard-99-p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it('resolves a valid elementId into scope with subtree slotIds and style tokens', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');
    const result = resolveScope(content, styleGuide, card.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scope?.elementId).toBe(card.id);
      expect(result.scope?.elementType).toBe('InfoCard');
      expect(result.scope?.styleTokens.radius).toContain('md');
    }
  });

  it('elementType takes precedence and redirects even when elementId is also valid', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const result = resolveScope(content, undefined, card.id, 'InfoCard');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe('channel-independent outcome helpers', () => {
  it('applies a successful slot channel even when the style channel fails', () => {
    const content = ingestCardsPage();
    const slotId = content.slotOrder.find((id) => content.slots[id].tag === 'h1')!;
    const slotResult = validateChanges(content, [{ slotId, value: 'Updated heading' }]);
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');
    const styleResult = validateElementStyleChanges(content, styleGuide, card.id, [
      { elementId: card.id, padding: 'not-a-real-token' },
    ]);

    const outcome: ChatTurnOutcome = {
      proposal: { changes: [], explanation: '', provider: 'anthropic' },
      slot: slotResult,
      style: styleResult,
    };

    expect(slotResult.ok).toBe(true);
    expect(styleResult.ok).toBe(false);
    expect(nothingApplied(outcome)).toBe(false);
    expect(anyProposedChannelFailed(outcome)).toBe(true);
    expect(collectErrors(outcome).some((e) => e.startsWith('[style]'))).toBe(true);

    const updated = applyPatches(content, outcome);
    expect(updated.slots[slotId].value).toBe('Updated heading');
    expect(updated.namedElements![card.id].styleOverrides).toBeUndefined();
  });

  it('reports overall failure only when every proposed channel fails', () => {
    const content = ingestCardsPage();
    const card = Object.values(content.namedElements!).find((el) => el.type === 'InfoCard')!;
    const styleGuide = buildDefaultStyleGuide('acme', 'Acme', 'modern');
    const styleResult = validateElementStyleChanges(content, styleGuide, card.id, [
      { elementId: card.id, padding: 'not-a-real-token' },
    ]);

    const outcome: ChatTurnOutcome = {
      proposal: { changes: [], explanation: '', provider: 'anthropic' },
      style: styleResult,
    };

    expect(nothingApplied(outcome)).toBe(true);
    expect(anyProposedChannelFailed(outcome)).toBe(true);
  });
});
