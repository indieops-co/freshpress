/**
 * Upgrade/checkout URL surfaced to free-tier users so the editor's UpgradeNotice can link
 * out to it. Vendor-neutral by design (core, shown in the free build): the vendor points
 * `FRESHPRESS_CHECKOUT_URL` at their hosted checkout (e.g. a LemonSqueezy checkout link)
 * or a pricing page. Unset or non-http(s) → null, and the editor renders no button.
 */
export function getUpgradeUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.FRESHPRESS_CHECKOUT_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // It becomes an href — only allow http(s), never javascript:/data: and friends.
    if (url.protocol === 'http:' || url.protocol === 'https:') return raw;
  } catch {
    /* not a URL */
  }
  return null;
}
