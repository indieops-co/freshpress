# Human test suite — Marketing homepage + demo funnel + rich demo seed

Branch: `claude-marketing-demo`. What Claude already verified automatically:
gate matrix + seed-content invariants (unit tests, 575 total green), seed
idempotence (double run), `/` serving + non-demo redirect + `/legal/*` (curl),
every seeded surface via authenticated API (design, pages, inbox folders/
threads/dashboard stats, submissions, campaigns), themed page-preview HTML,
and the homepage early-access POST. What needs human eyes: visual layout,
in-browser flows, and taste calls (theme choice, copy).

## Setup

```bash
npm run build          # or reuse existing editor/dist
DATA_DIR=/tmp/fp-human npx tsx scripts/seed-demo.ts
DATA_DIR=/tmp/fp-human DEMO_MODE=1 npm start   # or: npx tsx src/server.ts
```

Open http://localhost:3001/

## 1. Marketing homepage (visual)

- [ ] Hero: headline, subhead, both CTAs visible; layered browser-frame art looks intentional, not broken
- [ ] Page feels clean/spacious — no dense text blocks, sections breathe
- [ ] Slideshow: real app screenshots (captured via Playwright from the seeded demo) with headline/caption bars; auto-advances ~5s; arrows, dots, and ←/→ keys work; hover pauses. TASTE CALL: reshoot any slide you don't like per `marketing/README.md` — deleting an image file safely falls back to a styled placeholder
- [ ] Value-prop rows alternate sides; the 5 mini-illustrations (guardian card, theme stack, inbox rows, WordPress export, publish line) render cleanly
- [ ] Hosting: two cards (Cloud / Self-Hosted) + "publish to your own free Vercel" note — copy matches the real offering
- [ ] Early access: submit an email → button disables → success message replaces form; submit 6× fast → rate-limit error message appears (5/hr in demo mode)
- [ ] Footer: Purchase Terms (`/legal/eula`), Commercial License (`/legal/license`) and Free License (`/legal/free`) open as readable plain text
- [ ] Narrow the window below ~760px: nav links hide, hero stacks, cards stack — nothing overflows horizontally

## 2. Root-route gating

- [ ] Restart the server WITHOUT `DEMO_MODE=1` → visiting `/` redirects to `/editor` (login screen)

## 3. Demo funnel

- [ ] From the homepage, "Try the live demo — no signup" lands in the dashboard with NO login (auto demo session) and the demo banner shows
- [ ] Dashboard shows the "Acme Plumbing & HVAC" site card

## 4. Seeded surfaces (in the demo)

- [ ] **Site Theme**: Stripe-derived guide applied (indigo primary); specimens render; theme gallery available under "Switch theme"
- [ ] **Editor**: 4 pages (Home, About, Contact, Services); Home preview renders themed (indigo buttons, hero, cards); clicking a slot opens the edit panel; TASTE CALL: does the Stripe theme suit a plumbing company, or should `DEMO_THEME_ID` in `src/demo/seed-content.ts` change (one-line edit, e.g. `webflow`)?
- [ ] **Inbox**: folders Inbox/Drafts/Sent/Leads/Suppliers (Leads has a filter/funnel + color); 8 threads with mixed read/unread; "No hot water since this morning" thread shows an AI-generated draft reply (badge); dashboard stats non-zero
- [ ] **Forms**: 5 submissions listed; detail modal opens
- [ ] **Campaigns**: "Water heater replacement nurture" draft with 3 steps (delays 0/3/7 days)
- [ ] **Blog / Social**: unchanged from before — post + pending social batch still present
- [ ] Publish, delete site, ingest, WP import still blocked (403 toast) in demo mode

## 5. Screenshots for the slideshow (when ready)

Follow `marketing/README.md` — capture the 6 screens at ~1600×1000 into
`marketing/public/assets/slides/`, reload `/`, placeholders are replaced.

## 6. Mongo mode (optional, before deploying the demo instance)

- [ ] With `MONGODB_URI` set: seed → `--reset` → re-seed; confirm inbox/theme/campaign return to exactly the seeded state (reset now clears the new collections)
