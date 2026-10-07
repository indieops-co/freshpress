# FreshPress marketing site

Static files served at `/` by the Express server when the marketing gate is
on (see `src/marketing/gate.ts`): `MARKETING_SITE=1` forces it on,
`MARKETING_SITE=0` forces it off, and it defaults ON when `DEMO_MODE=1`.
Buyer and self-hosted instances (neither flag) get a `/` → `/editor`
redirect instead.

No build step — everything in `public/` is served as-is.

## Slideshow screenshots

The "See it in action" slideshow reads `public/slides.json`. A first set of
screenshots (captured with Playwright from the seeded demo) ships in
`public/assets/slides/`. If an image is missing, its slide renders a styled
placeholder frame instead — so deleting a stale screenshot is always safe.

To re-capture screenshots as the UI evolves (build the editor first —
`npm run build --prefix editor` — the server serves the built bundle, and a
stale `editor/dist` will screenshot an old UI):

1. Run the app locally with seeded demo data:
   ```bash
   npm run build
   DATA_DIR=/tmp/fp-demo npx tsx scripts/seed-demo.ts
   DATA_DIR=/tmp/fp-demo DEMO_MODE=1 npm start
   ```
2. Open `http://localhost:3001/editor?demo=1` in a browser window sized
   about **1600 × 1000** (the slide frame crops from the top-left, 16:9.5).
3. Capture each screen and save as PNG into `public/assets/slides/` using
   the exact filenames in `slides.json`:

   | File | Screen to capture |
   |---|---|
   | `wizard.png` | Create-site wizard — the direction picker with previews |
   | `themes.png` | Site Theme — the theme gallery (Switch theme panel open) |
   | `editor.png` | Editor — a page open with a slot selected + AI chat |
   | `inbox.png` | Inbox — 3-pane view with folders and an AI draft |
   | `campaigns.png` | Campaigns — a sequence with its steps expanded |
   | `blog.png` | Blog — a post open in the editor |

4. Reload `/` — the placeholders are replaced automatically.

To add/remove/reorder slides, edit `slides.json` (fields: `src`,
`headline`, `caption`).
