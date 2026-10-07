/**
 * FreshPress footer watermark — injected into published output on tiers without the
 * `removeWatermark` entitlement. Deliberately plain inline HTML in the static page:
 * a free user can hand-edit it out of a published snapshot (the tier matrix calls it
 * "manually removable"); the paid feature is that it never appears in the first place.
 */

/** FreshPress's public home page — the watermark link and the URL in exported themes.
 *  Env-overridable (also the future white-label hook). */
export function productUrl(): string {
  return process.env.FRESHPRESS_WATERMARK_URL ?? 'https://freshpress.dev';
}

export function watermarkHtml(): string {
  return (
    '<div class="freshpress-watermark" style="text-align:center;font:12px/1.6 system-ui,sans-serif;padding:16px 0;opacity:.7">' +
    `Made with <a href="${productUrl()}" rel="nofollow noopener" target="_blank" style="color:inherit">FreshPress</a>` +
    '</div>'
  );
}

/** Insert the watermark just before the closing </body>; append when there is none. */
export function injectWatermark(html: string): string {
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return `${html}\n${watermarkHtml()}\n`;
  return `${html.slice(0, idx)}${watermarkHtml()}\n${html.slice(idx)}`;
}
