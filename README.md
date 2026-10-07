# FreshPress CMS

Client-safe CMS for agency-built sites — ingest, edit, validate, and publish static websites.

## Features

- **Ingest** — Import HTML pages into frozen templates with editable content slots
- **Guardian** — Deterministic validation before any content change is applied
- **Editor** — Inline slot editing with optional AI-assisted proposals
- **Publish** — Immutable static snapshots with optional Vercel deployment
- **Forms** (Pro) — Per-site contact + signup forms via your own email provider (Resend, SendGrid, Postmark, or SMTP — BYOK; see `docs/EMAIL.md`)
- **SEO prompts** — Developer-facing Cursor prompts for React/Next.js SEO work
- **WordPress** — Export as PHP theme ZIP; import from WXR
- **Brand Studio** — Agent skill that art-directs a full brand (palette, type, logo)
  and builds a cinematic scroll-film site, then imports the brand as the site's
  StyleGuide (see [docs/BRAND-STUDIO.md](docs/BRAND-STUDIO.md)). Free lane: pure-code
  GSAP motion. Pro lane: real generated video footage (BYO Higgsfield/Kie account)

## Roles

| Role | Who | Login | Purpose |
|------|-----|-------|---------|
| **Vendor** | You (FreshPress seller) | — | Ship updates; optionally host CMS for buyers |
| **Agency owner** | Your buyer | Owner + `MASTER_KEY` | Build sites, settings, client passwords, invites |
| **End client** | Buyer's customer | Client + site ID + site password | Edit content slots for one site; design stays locked |

End clients use `{APP_URL}/editor/?site={siteId}`. The CMS must be **always-on at a public URL** — a laptop-only install does not work for remote client editing.

## Deployment by user level

FreshPress splits **where you edit** (CMS) from **what visitors see** (published static sites).

```text
┌─────────────────────────────────────────────────────────────────┐
│  CMS host (Railway or Fly)                                       │
│  API + /editor  ·  MongoDB  ·  volume for snapshots/media       │
│  Agency owner + end clients log in here                           │
└────────────────────────────┬────────────────────────────────────┘
                             │ publish (VERCEL_TOKEN)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Buyer's Vercel — live client websites (static HTML)             │
│  Public visitors; pages stay up if CMS is briefly down           │
└────────────────────────────┬────────────────────────────────────┘
                             │ contact form POST
                             ▼
                      CMS API (APP_URL) → email provider (buyer BYOK)
```

| Layer | Platform | Holds |
|-------|----------|--------|
| CMS app | **Railway** or **Fly.io** | Editor, API, auth, form handler |
| CMS data | **MongoDB Atlas** | Sites, pages, versions, passwords, form inbox, email config |
| CMS files | **Volume** on Railway/Fly (`DATA_DIR`) | Publish bundles, WordPress media (until object storage) |
| Live sites | **Buyer's Vercel** | Static HTML for end-customer domains |
| Email | **Buyer's provider** (Resend default; SendGrid/Postmark/SMTP) | Per-site credentials (BYOK) |

**Vercel is not the CMS host** — it is the publish target for client websites. Railway/Fly fits the current Express app, disk snapshots, and long imports better than serverless.

---

### Level 1 — Local development (vendor or agency developer)

**Who:** Building or customizing FreshPress on a machine.

**Setup:**

```bash
cp .env.example .env
# Set MASTER_KEY in .env

npm install
npm run dev          # API on http://localhost:3001
npm run dev:editor   # Editor on http://localhost:5173 (proxies /api)
```

| Item | Value |
|------|--------|
| Storage | `./data` (filesystem) or optional `MONGODB_URI` |
| `APP_URL` | `http://localhost:3001` |
| Client editing | Same machine only unless you tunnel a public URL |
| Live sites | Optional `VERCEL_TOKEN` to deploy test publishes |

**Not for production client access.**

---

### Level 2 — Self-hosted cloud CMS (technical agency buyer)

**Who:** Agency runs their own always-on CMS so staff and **end clients** can edit from anywhere.

**Stack:** Railway or Fly + MongoDB Atlas + volume + buyer's Vercel for published sites.

| Step | Action |
|------|--------|
| 1 | Create MongoDB Atlas database (e.g. `freshpress_agencyname`) |
| 2 | Deploy repo to **Railway** or **Fly.io** (Node 20, `npm run build`, `npm start`) |
| 3 | Mount persistent volume → set `DATA_DIR=/data` |
| 4 | Set env: `HOSTED=1`, `MASTER_KEY`, `MONGODB_URI`, `APP_URL=https://cms.agency.com` |
| 5 | Set `VERCEL_TOKEN` (agency's) for publish-to-client-sites |
| 6 | Owner logs in → create site → set client password → send invite |

**Handoff to end client:** `{APP_URL}/editor/?site={siteId}` + site password (see Site Settings → Access).

---

### Level 3 — Vendor-hosted CMS (default for non-technical buyers)

**Who:** You operate one Railway/Fly app **per agency buyer**. Buyer never installs anything.

| You provision | Buyer receives |
|---------------|----------------|
| Railway/Fly service + volume | CMS URL |
| Atlas DB `freshpress_{slug}` | Owner `MASTER_KEY` |
| Custom domain on `APP_URL` | Onboarding doc |

Buyer adds **their** keys: email provider (per site in dashboard — Resend recommended), Vercel token (env or Admin UI), optional AI keys.

---

### Level 4 — End client (no deployment)

**Who:** Small business editing the site the agency built for them.

| Need | Provided by agency |
|------|-------------------|
| Editor URL | `{APP_URL}/editor/?site={siteId}` |
| Login | Client mode + site ID + password |
| Hosting | Nothing — uses agency's CMS URL |

Clients do not deploy FreshPress. Published **visitor-facing** site lives on the agency's Vercel project.

---

### Level 5 — Source install (power users) — free core + Pro overlay

**Who:** Buyer wants full source control on their own infra.

FreshPress ships as a **free core plus a private Pro overlay**:

- **Free tier:** clone the public free core (`github.com/indieops-co/freshpress`)
  and run it as-is. Same stack as Level 2 (cloud server recommended; not a laptop).
- **Pro / Agency tier:** buy via LemonSqueezy → receive the Pro overlay **tarball
  plus a license key** (no repo access). Extract the tarball at the repo root — it
  lands in `src/paid/` — set `FRESHPRESS_LICENSE_KEY`, then `npm install && npm run
  build`. The overlay is detected by filesystem presence and the tier unlocks at
  runtime via LemonSqueezy license validation.
- You do not host; buyer owns uptime and `APP_URL`.

Licenses: the free core is licensed under the **IndieOps Free License v1.0** (`LICENSE`):
free to use, including commercially, but source-available rather than open source, so
please don't redistribute it. Third-party credits are in `NOTICE.md`, and the WordPress
plugin in `wp-plugin/` is GPL-2.0-or-later. The Pro overlay is licensed under the
**IndieOps Commercial License v1.0** with the FreshPress Purchase Terms; both ship
inside the Pro tarball (`COMMERCIAL-LICENSE.md`, `EULA.md`).

---

## Quick start (local)

```bash
cp .env.example .env
# Set MASTER_KEY in .env

npm install
npm run dev
npm run dev:editor
```

Production build (same process Railway/Fly runs):

```bash
npm run build
npm start
# Serves API + editor at /editor from editor/dist
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default `3001`) |
| `MASTER_KEY` | Agency owner authentication key |
| `APP_URL` | Public CMS URL — editor invites, contact form API |
| `DATA_DIR` | Storage root (default `./data`; use `/data` on Railway/Fly volume) |
| `MONGODB_URI` | MongoDB Atlas — **required** for hosted (`HOSTED=1`) |
| `FRESHPRESS_DB_NAME` | MongoDB database name (default `freshpress`) |
| `HOSTED` | Set to `1` on Railway/Fly production CMS instances |
| `VERCEL_TOKEN` | Deploy published client sites to buyer's Vercel |
| `VERCEL_TEAM_ID` | Optional Vercel team |

Per-site email provider credentials are configured in the dashboard (Site Settings → Email), not only in env.

## Packages

- `freshpress` — Express API and core logic (root)
- `freshpress-editor` — React/Vite dashboard and editor (`/editor`)

## Architecture

- Dashboard architecture: `docs/freshpress-dashboard-architecture.md`

## Tests

```bash
npm test
```
