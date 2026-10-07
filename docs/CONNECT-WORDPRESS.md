# Connect your site to WordPress

Publish a FreshPress site into a WordPress install with the **FreshPress Connector**
plugin. FreshPress stays the source of truth — the plugin only ever pulls your
**published** content into WordPress; drafts never leave FreshPress.

This guide is for the site owner setting up a real (live) WordPress site. If you're a
developer or QA'ing the plugin itself, see [`wp-plugin/README.md`](../wp-plugin/README.md).

## Before you start

- **Publish your site in FreshPress first.** The connector serves published content
  only. Create your pages and click **Publish** — if nothing is published, WordPress
  will sync nothing.
- **A WordPress site you can install plugins on.** Any standard WordPress works —
  including cloud hosts (SiteGround, GoDaddy, Kinsta, WP Engine, Bluehost, etc.).
  You need PHP 7.4+ and WordPress 6.0+.
- **Your WordPress server must be able to reach your FreshPress app over HTTPS.** The
  plugin makes outbound calls to your FreshPress URL (e.g. `https://app.yourfreshpress.com`),
  so in production use the app's real public URL — not `localhost`.

## Setup (5 steps)

1. **Publish in FreshPress.** Make sure the pages you want live are published.

2. **Get the plugin.** Download `freshpress-connector-<version>.zip` from your FreshPress
   vendor (or the FreshPress releases page).

3. **Install & activate on WordPress.** In WP Admin → **Plugins → Add New → Upload
   Plugin**, choose the zip, **Install Now**, then **Activate**.

4. **Issue a connector token in FreshPress.** Open **Site Settings → WordPress Connector**
   and click **Issue connector token** (owner/admin only). The token is shown **once** —
   copy it immediately.

5. **Connect in WordPress.** In WP Admin → **Settings → FreshPress**, paste:
   - **App URL** — your FreshPress app's public HTTPS URL
   - **Token** — the token from step 4

   Click **Test connection** (you should see your site name and published page count),
   then **Sync now**. Your published pages appear in WordPress.

That's it. The connector card in FreshPress will flip to **🟢 Connected** after the
first sync.

## Optional: test on a local WordPress first

If you're setting up a paying client's live site, you can dry-run the whole flow against
a throwaway **local** WordPress before touching the live host — a one-time confidence
check, not a per-site requirement.

Tools like [LocalWP](https://localwp.com) or `@wordpress/env` give you a real WordPress
running on your own machine. Install the plugin there, point it at your FreshPress app,
and confirm a sync looks right — then install the plugin on the client's live cloud site
exactly the same way. Step-by-step local instructions are in
[`wp-plugin/README.md`](../wp-plugin/README.md#local-wordpress-setup-to-run-the-manual-test-plan).

> This is a pre-flight for the person installing the plugin. It is **not** a staging
> lane you run for every edit — FreshPress itself is the review gate, since the connector
> only ever serves published content.

## Keeping WordPress in sync

- **Automatic:** enable the twice-daily sync in WP → Settings → FreshPress, and the
  plugin pulls the latest published content on a schedule.
- **On demand:** click **Sync now** in WordPress any time after you publish in FreshPress.
- **Drift warning:** if you publish in FreshPress but WordPress hasn't pulled yet, the
  **WordPress Connector** card shows "⚠️ WordPress copy is behind." Run a sync to clear it.
- **Sync-back status:** after each sync, the connector card reports what WordPress did
  (created / updated / skipped / errors) and when.

## Managing the connection

All from **Site Settings → WordPress Connector** in FreshPress:

- **Rotate token** — issues a new token and immediately invalidates the old one. Paste
  the new token into WP → Settings → FreshPress to keep syncing.
- **Revoke token** — disconnects WordPress entirely; syncing stops until you issue a new
  token.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Test connection fails** | Check the App URL is the public HTTPS URL and reachable from the WP server (not `localhost` in production). Confirm the token was pasted with no stray spaces. |
| **Sync pulls nothing** | Nothing is **published** in FreshPress. Publish, then sync. |
| **401 / "unauthorized" after rotating** | WordPress still has the old token. Paste the new one into WP → Settings → FreshPress. |
| **"WordPress copy is behind"** | You published in FreshPress but WordPress hasn't synced. Click **Sync now** or wait for the twice-daily cron. |
| **A page I edited in WordPress got overwritten** | Managed pages are owned by FreshPress; every sync overwrites local WP edits. Make content changes in FreshPress. |
| **SEO tags missing on synced pages** | If Yoast or Rank Math is active, the plugin defers SEO output to them (the sync report notes this). Set titles/descriptions in your SEO plugin, or deactivate it to let FreshPress manage SEO. |
| **Nav menu isn't showing** | The plugin builds a menu named **FreshPress** but doesn't auto-assign it. Set it once in WP → Appearance → Menus. |

## See also

- [`docs/BUYER-SETUP.md`](BUYER-SETUP.md) — overall FreshPress setup for a new instance
- [`wp-plugin/README.md`](../wp-plugin/README.md) — developer/QA reference for the plugin
  and local test plan
