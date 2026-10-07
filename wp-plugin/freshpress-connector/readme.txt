=== FreshPress Connector ===
Contributors: freshpress
Tags: sync, pages, headless
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.3.0
License: GPL-2.0-or-later

Pulls published pages from a FreshPress workspace into WordPress. FreshPress stays the source of truth.

== Description ==

Connects this WordPress site to a FreshPress site with a per-site connector token.

* **Published content only** — the connector serves the last published snapshot; drafts in FreshPress never reach WordPress.
* **Hash-gated sync** — pages are skipped when unchanged, so re-syncs are cheap.
* **Canvas rendering** — synced pages render full-bleed through a minimal template so FreshPress's design ships intact, with wp_head/wp_footer preserved.
* **Media sideload** — images are imported into the media library and the page HTML is pointed at the local copies.
* **Safe by default** — pages removed in FreshPress become drafts here (never deleted); local edits to managed pages are flagged with an admin notice.
* **Dry run** — preview exactly what a sync would create, update, skip, or draft.

== Installation ==

1. Upload the `freshpress-connector` folder to `/wp-content/plugins/`, or install the zip.
2. Activate the plugin.
3. In FreshPress, issue a connector token for the site (Site settings — the token is shown once).
4. In WordPress, go to Settings → FreshPress, enter the FreshPress app URL and the token, and click "Test connection".
5. Click "Dry run" to preview, then "Sync now".

== Frequently Asked Questions ==

= Why is a page I created in FreshPress missing? =
The connector only sees published content. Publish the site in FreshPress, then sync again.

= Can I edit a synced page in WordPress? =
You can, but the next sync overwrites it — the edit screen warns you. Edit in FreshPress instead.

== Changelog ==

= 0.3.0 =
* After each sync the plugin posts a status summary back to FreshPress (fire-and-forget), so the dashboard shows the WordPress-side result.
* Clear, distinct messages for a rate-limited connector (HTTP 429, transient) vs. a rejected token (HTTP 401, needs a new token).

= 0.2.0 =
* Internal links between synced pages are rewritten to local WordPress permalinks (external links untouched).
* Contact forms (marked by FreshPress) are wired to the site's contact endpoint and submit over fetch() with a dependency-free handler.
* Per-page SEO: managed pages set the document title and a meta description (skipped, with a note, when Yoast or Rank Math is active).
* A "FreshPress" nav menu is rebuilt from the site hierarchy each sync (assign it to a theme location in Appearance → Menus).
* New WP-CLI command: `wp freshpress sync [--dry-run]`.
* The settings screen shows the last sync outcome from any trigger (button, cron, or CLI).

= 0.1.0 =
* Initial release: settings + token, test connection, hash-gated sync engine, canvas template, media sideload, managed-page notice, dry run, optional twice-daily auto-sync.
