# Changelog

All buyer-facing changes are documented here. Format: `## v0.x.0 — YYYY-MM-DD`.

---

## v0.11.1 — 2026-10-06

### Fixed
- **Pro install:** the Pro package now includes the Deep Brand Research files that live outside `src/paid/`. In v0.11.0 they were missing from the Pro download, so a Pro install on top of the free edition failed to build. The free edition is unchanged.

---

## v0.11.0 — 2026-10-06

First public release of the FreshPress free edition: https://github.com/indieops-co/freshpress

### Licensing
- The free edition is licensed under the **IndieOps Free License v1.0**. It is free to use, including commercially, and source-available rather than open source (see `LICENSE`). FreshPress Pro is licensed under the **IndieOps Commercial License v1.0** with the FreshPress Purchase Terms. The WordPress connector plugin is GPL-2.0-or-later. Third-party credits are in `NOTICE.md`.

### New
- **Email system (Pro)** — bring your own provider (Resend, SendGrid, Postmark or SMTP), set up with a guided wizard. Includes:
  - contact forms;
  - newsletter signups with double opt-in, plus signed webhooks to Zapier, CRMs and outreach tools;
  - **campaigns** that send natively: a nurture sequence per blog pillar, plus an optional welcome campaign for every other signup, with one-click unsubscribe;
  - with Resend, a built-in site inbox with folders, branded compose, scheduled sends and AI-drafted replies.

  See `docs/EMAIL.md`.
- **WordPress Connector (Pro)** — a WordPress plugin plus the Connect API that sync published pages into WordPress, including internal links, contact and signup forms, SEO and navigation, WP-CLI commands, sync-back status and drift detection. See `docs/CONNECT-WORDPRESS.md`.
- **Create-site wizard** — AI site generation from a brand intake:
  - up to three design directions with live previews;
  - 20 vendored brand design systems;
  - an optional Design Powerpack critique;
  - an optional newsletter-signup section (Pro).
- **Deep Brand Research (Pro)** — an AI research wizard whose findings enrich generated pages, social posts and emails.
- **Client-safe publishing** — publish permissions, a review workflow, edit-only team members, and Vercel team provisioning.
- **Plans and license keys** — Free, Pro and Agency plans. Pro features unlock with a license key (72-hour offline grace), with upgrade prompts and a pricing page.
- **Email brand themes** — reusable email formats and templates for branded compose and campaign steps.
- **Brand Studio** — agent skill (`ref/skills/brand-studio/`, install one-liner in `docs/BRAND-STUDIO.md`) that art-directs a complete brand (palette, type pairing, logo lockup) and builds a cinematic scroll-film website, then imports the brand as the site's StyleGuide. Free lane: pure-code GSAP/Lenis motion. Pro lane: real generated-video footage via the overlay pack `src/paid/skills/brand-studio-footage/` (BYO Higgsfield/Kie account, costs quoted before any spend).
- **Design import endpoint** — `POST /sites/:siteId/design/import` accepts a raw DESIGN.md (plus optional logo media URL) and activates it as the site's StyleGuide; StyleGuide gains an optional `logo` pointer, and the email `header-logo` block now renders it.
- **Marketing homepage** — static public homepage served at `/` (from `marketing/public/`) with screenshot slideshow, live-demo CTA, hosting comparison, and early-access capture. Gated by `MARKETING_SITE` (defaults ON when `DEMO_MODE=1`, OFF otherwise — see `src/marketing/gate.ts`); legal docs served at `/legal/eula` (Purchase Terms), `/legal/license` (Commercial License) and `/legal/free` (Free License).
- **Rich demo seed** — `scripts/seed-demo.ts` now also seeds a full themed site for Acme Plumbing & HVAC (Stripe-derived StyleGuide + 4 generated pages), an email inbox (5 folders, 8 threads, AI draft), 5 form submissions, and a 3-step draft nurture campaign (`src/demo/seed-content.ts`, deterministic, no AI calls). `--reset` clears the new collections.

### Improved
- On buyer/self-hosted instances, `/` now redirects to `/editor` instead of returning 404.
- Exported WordPress themes are styled from the site's design system.
- In-app help links open the public guides; exported themes and the connector plugin link to freshpress.dev.

### Changed
- Renamed from ClaudePress to FreshPress. The WordPress theme helpers are now `freshpress_*`, and the default MongoDB database name is `freshpress` (was `claudepress`). Existing installs that relied on the old default should set `FRESHPRESS_DB_NAME=claudepress` or migrate their data.

---

## v0.10.0 — 2026-06-11

### New
- **Social Content Pipeline** — AI-generated social drafts (LinkedIn, X, Instagram, Facebook) from published blog posts. Pending batches for admin review; drafts tab for copy-paste and mark-as-posted. Client users see Drafts only.
- **Admin User Profiles** — Email + password login for agency staff. Workspace bootstrap via MASTER_KEY. Session management (30-day tokens).
- **Demo Mode** — `DEMO_MODE=1` env enables credential-free public demo with Early Access email capture and nightly database reset.
- **Seed Data** — `scripts/seed-demo.ts` populates workspace, site, blog, and social drafts for demo and buyer onboarding.

### Improved
- `docs/BUYER-SETUP.md` updated with onboarding sample site walkthrough.
- `docs/DEPLOYMENT-ECOSYSTEM.md` — full platform and tier reference.
- `EULA.md` — proprietary license placeholder (attorney review required before first sale).

---

## v0.9.0 — 2026-05-XX

*(Previous internal waves — Wave 1 through 9 — see internal release notes.)*
