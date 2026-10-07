/**
 * Wires the preview iframe's [data-element-id] wrappers (Chunk 4, src/content/render.ts) to the
 * sidebar's selection state — click-in-preview selects, select-in-sidebar scrolls/highlights.
 *
 * Deliberately NOT a postMessage bridge: the iframe only ever carries sandbox="allow-same-origin"
 * (no allow-scripts), so no script runs inside the framed page content at all. This module reaches
 * into iframe.contentDocument directly from the parent — already permitted by allow-same-origin —
 * which delivers the identical click/highlight behavior without ever executing script inside
 * untrusted (AI-generated/ingested) page HTML. Re-attach on every iframe load, since a fresh
 * srcDoc is a fresh document with fresh nodes.
 */

const HIGHLIGHT_CLASS = 'fp-element-highlight';
const HIGHLIGHT_STYLE = `.${HIGHLIGHT_CLASS} { outline: 2px solid #6c8cff !important; outline-offset: 2px; }`;

export interface HighlightOptions {
  /** Set false when the selection came from clicking the element itself — it's already in view. */
  scroll?: boolean;
}

export interface PreviewBridge {
  highlight(elementId: string | null, options?: HighlightOptions): void;
  /** Remove the listener/style this bridge added — call before re-attaching or on unmount. */
  destroy(): void;
}

export function attachPreviewBridge(
  iframe: HTMLIFrameElement,
  onSelectElement: (elementId: string) => void
): PreviewBridge | null {
  const doc = iframe.contentDocument;
  if (!doc) return null;

  const styleTag = doc.createElement('style');
  styleTag.setAttribute('data-fp-editor-highlight', '');
  styleTag.textContent = HIGHLIGHT_STYLE;
  (doc.head ?? doc.documentElement).appendChild(styleTag);

  // One delegated listener instead of one per element — cheaper to attach/tear down on every
  // srcDoc reload, and doesn't need re-binding if content.namedElements grows without a reload.
  function handleClick(e: Event) {
    const target = e.target as Element | null;
    const el = target?.closest('[data-element-id]');
    const id = el?.getAttribute('data-element-id');
    if (id) {
      e.stopPropagation();
      onSelectElement(id);
    }
  }
  doc.addEventListener('click', handleClick);

  let highlighted: Element | null = null;

  function highlight(elementId: string | null, options?: HighlightOptions) {
    if (highlighted) {
      highlighted.classList.remove(HIGHLIGHT_CLASS);
      highlighted = null;
    }
    if (!elementId) return;
    const selector = `[data-element-id="${CSS.escape(elementId)}"]`;
    const el = doc!.querySelector(selector);
    if (el) {
      el.classList.add(HIGHLIGHT_CLASS);
      if (options?.scroll !== false) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      highlighted = el;
    }
  }

  return {
    highlight,
    destroy() {
      doc.removeEventListener('click', handleClick);
      if (highlighted) highlighted.classList.remove(HIGHLIGHT_CLASS);
      styleTag.remove();
    },
  };
}
