# FreshPress Connector (WordPress plugin)

`freshpress-connector/` is the WordPress side of the Connect API (`src/api/connect.ts`).
Zip that folder (or symlink it into `wp-content/plugins/`) to install.

## How it fits together

| FreshPress (this repo) | Plugin |
|---|---|
| Site Settings → **WordPress Connector** card issues the per-site token (owner/admin; shown once) | Settings → FreshPress: paste app URL + token |
| `GET /api/connect/v1/manifest` — published pages + `content_hash`, `path`, `seo_*` per page | Test connection, and the sync plan (hash gate) |
| `GET /api/connect/v1/pages/:pageId` — self-contained html + assets | Fetched only for changed pages |

Key plugin behaviors (all in `includes/`):

- **Hash gate** (`class-fp-sync-engine.php`): `_freshpress_content_hash` post meta vs the manifest hash; equal → page skipped without fetching its payload.
- **Canonical HTML lives in `_freshpress_html` post meta**, echoed raw by `templates/canvas.php` via `template_include`. It does NOT go through `post_content`, because `wpautop`/`kses` would mangle the inline `<style>` blocks that carry the FreshPress design. `post_content` holds the plain-text excerpt for search.
- **Media sideload**: payload assets are imported once (attachments tagged `_freshpress_source_url`) and the HTML is rewritten to local URLs; re-syncs reuse existing attachments.
- **Internal links** (`class-fp-links.php`): `<a href>` values that point at the FreshPress app (or are root-relative) and map to a synced page are rewritten to the local WordPress permalink after every page exists. External and unmapped links are left alone.
- **Contact forms** (`class-fp-forms.php`): a form marked `data-fp-form="contact"` is pointed at the manifest's `contact_endpoint` and gets a dependency-free `fetch()` submit handler (visitor stays on the page). Non-contact forms are untouched.
- **Per-page SEO** (`class-fp-canvas.php`): managed pages set the document title (`pre_get_document_title`) and emit `<meta name="description">`. If Yoast or Rank Math is active, SEO output is skipped and the sync report says so.
- **Nav menu** (`class-fp-nav.php`): a menu named **FreshPress** is rebuilt from the manifest hierarchy each sync. It is not auto-assigned — set it in Appearance → Menus once.
- **Sync visibility**: every real sync (button, cron, or `wp freshpress sync`) persists a trimmed summary; the settings screen shows "Last sync: … — N created / updated / skipped / drafted / errors".
- **Safety**: pages removed upstream are drafted, never deleted. `uninstall.php` removes settings only — content stays, and meta survives so reinstalling reconnects instead of duplicating.
- **Parents**: `parent_slug` from the manifest is applied in a second pass (children can precede parents in one sync).

## WP-CLI

    wp freshpress sync            # pull published pages
    wp freshpress sync --dry-run  # report what would change, write nothing

## Building & releasing

Build a distributable zip from the plugin source:

    npm run build:wp-plugin       # -> dist/freshpress-connector-<version>.zip

The version comes from the `Version:` header in `freshpress-connector.php` (single source of
truth). Builds are deterministic — only distributable files are included, entries are sorted, and
timestamps are fixed, so a re-run produces a byte-identical archive. The zip unpacks to a
`freshpress-connector/` folder ready to drop into `wp-content/plugins/`.

**Release flow (GitHub-release based):**

1. Bump the version in three places: the `Version:` header, `FRESHPRESS_CONNECTOR_VERSION`, and
   `readme.txt` `Stable tag:` — and add a `readme.txt` changelog entry.
2. `npm run build:wp-plugin`.
3. Create a GitHub release tagged `wp-plugin-v<version>` (or `v<version>`) and attach the zip.
4. Site owners update by downloading the new zip and re-installing (WordPress → Plugins → Add New
   → Upload, overwriting the existing folder; managed content and `_freshpress_*` meta are
   preserved). There is no in-wp-admin auto-update notice — that would require vendoring an
   update-checker library (intentionally left out; ask if you want it).

## Local WordPress setup (to run the manual test plan)

There's no WP test harness in this repo, so the plugin side is exercised by hand against a local
WordPress. You need three things running together: a local WP, the FreshPress app, and the plugin
installed in that WP and pointed at the app.

First, start the FreshPress app from the repo root:

    npm run dev        # FreshPress at http://localhost:3001

### Option A — LocalWP (simplest, no Docker)

1. Install [LocalWP](https://localwp.com), create a site (PHP 7.4+, WP 6.0+).
2. Install the plugin one of two ways:
   - **Symlink the source** (edits show up live): from the LocalWP site's `app/public/wp-content/plugins/`,
     `ln -s /ABS/PATH/TO/repo/wp-plugin/freshpress-connector freshpress-connector`
   - **Or upload a build**: `npm run build:wp-plugin`, then WP Admin → Plugins → Add New → Upload Plugin →
     `dist/freshpress-connector-<ver>.zip`.
3. Activate **FreshPress Connector**.
4. App URL to use in the plugin: `http://localhost:3001` (LocalWP runs on the host, so plain localhost works).
5. WP-CLI ships with LocalWP: right-click the site → **Open site shell** → `wp freshpress sync --dry-run`.

### Option B — wp-env (Docker, scriptable)

1. `npm -g i @wordpress/env` (needs Docker Desktop running).
2. Drop a `.wp-env.json` in the repo root to auto-mount the plugin:
   ```json
   { "core": "WordPress/WordPress#6.7", "plugins": [ "./wp-plugin/freshpress-connector" ] }
   ```
3. `wp-env start` → WP at `http://localhost:8888` (admin: `admin` / `password`); activate the plugin.
4. **Networking:** WP is in a container but the FreshPress app is on the host, so use
   `http://host.docker.internal:3001` as the app URL (Docker Desktop; on Linux add
   `--add-host=host.docker.internal:host-gateway` or use the host IP).
5. WP-CLI: `wp-env run cli wp freshpress sync`.

### Notes

- **Publish first.** The connector serves published content only — create and **publish** a site in
  FreshPress before syncing, or the plugin sees nothing.
- **Token.** Issue it in FreshPress (Site Settings → *WordPress Connector*, shown once) and paste it into
  WP → Settings → FreshPress.
- **Contact form / CORS.** The form POSTs browser → FreshPress app (cross-origin); the app sends global
  CORS headers, so no WP-side config is needed.
- **Self-signed HTTPS.** `wp_remote_*` may reject a self-signed cert — use plain `http` for local testing.

## Manual test plan (no WP test harness in this repo)

1. Local WP (e.g. LocalWP / wp-env / any dev site) + FreshPress running (`npm run dev`).
   If WP runs in Docker and FreshPress on the host, set the app URL to `http://host.docker.internal:3001`.
2. In FreshPress: create a site with pages, **publish it**, then open Site Settings → **WordPress Connector**
   and **Issue connector token** (owner/admin only; copy it from the one-time modal).
3. Plugin settings: enter URL + token → **Test connection** → expect site name + published page count.
4. **Dry run** → expect `create` rows for every published page, nothing written.
5. **Sync now** → pages appear (front page set if enabled); view one — full-bleed FreshPress design, admin bar intact.
6. Re-run **Sync now** → every row `skip (unchanged)`.
7. Edit a page in FreshPress *without* publishing → sync → still `skip` (drafts must not leak).
8. Publish in FreshPress → sync → that page `update`, content visibly changes.
9. Delete a page in FreshPress, publish, sync → WP page moves to draft.
10. Edit a managed page in WP admin → warning notice shows; next sync overwrites the edit.
11. Rotate the token in FreshPress (WordPress Connector card) → sync fails with the 401 message; paste the new token to recover.
12. **Internal links** — on a synced page, click a link that points to another synced FreshPress page → it stays on the WP site (lands on the local permalink). External links still leave the site.
13. **Contact form** — submit the contact form on a synced page → an inline "message sent" status appears and a submission shows up in FreshPress (Inbox / `GET /api/sites/:id/submissions`). (Requires email enabled on the FreshPress site.)
14. **SEO** — view a synced page's source: `<title>` matches the FreshPress SEO title and a `<meta name="description">` is present. With Yoast/Rank Math active, these are absent and the sync report notes it.
15. **Nav menu** — Appearance → Menus shows a **FreshPress** menu mirroring the page hierarchy; assign it to a theme location and confirm it renders.
16. **WP-CLI** — `wp freshpress sync --dry-run` then `wp freshpress sync` run headless; afterward the settings screen's "Last sync" line reflects the CLI run. Enable twice-daily cron and confirm the same line updates after it fires.
17. **Status sync-back** — after a WP sync, the FreshPress Site Settings → *WordPress Connector* card shows "WordPress last sync: … N created / updated / skipped / errors".
18. **Drift indicator** — publish in FreshPress without syncing WordPress → the card warns "WordPress copy is behind (last pulled …)". Run a WP sync → the warning clears on the next status load.
