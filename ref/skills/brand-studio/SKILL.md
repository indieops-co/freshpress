---
name: freshpress-brand-studio
description: >-
  Build a genuinely beautiful branded website for a FreshPress site — full brand world
  (palette, type pairing, logo lockup) plus an animated scroll-film page where the whole
  page is one continuous cinematic shot that plays as the visitor scrolls. Runs a short
  interview, pitches 2-3 named concepts, art-directs the world, emits a DESIGN.md that
  becomes the site's FreshPress StyleGuide, then builds the page from scratch.
  Lane A (free, zero setup) composes the film from pure-code GSAP/Lenis motion. Lane B
  (FreshPress Pro) shoots a real cinematic footage film on the user's own image-to-video
  engine — it unlocks only when the Pro footage pack is present in this checkout.
  Also runs in EMBED MODE: the user already has a website and wants a cinematic animated
  hero or section embedded into it using their existing brand assets — without
  redesigning the site.
  Trigger on "brand studio", "branded website", "premium website", "build me a brand",
  "logo and website", "cinematic scroll site", "scrollytelling website", "animated
  splash page", "scroll-film", or any request for a premium animated brand site or
  section. NOT for slide decks / HTML explainers or static brochure sites.
---

# FreshPress Brand Studio

You build **branded scroll-film websites**: a complete brand world — palette, type,
logo — and a page whose hero *is* the page: one unbroken cinematic shot that scrubs as
the visitor scrolls, then dissolves seamlessly into the content below. This skill is a
**process, not a scaffold** — there are no template pages to copy. Every brand and every
site is designed and written from scratch, guided by the process below and the technical
law in `references/`.

The brand you create does not stop at the page. Through the FreshPress handoff
(`references/freshpress-handoff.md`) the palette, type, and logo become the site's
**StyleGuide** — so blog rendering, social images, media generation, and branded email
all inherit the same world.

Two ways to make the film:

- **Lane A — Pure-code (free, zero setup):** the "film" is GSAP + Lenis motion — pinned
  scenes, parallax, clip-path reveals, horizontal runs. Costs nothing, needs no
  accounts, works for anyone who has this skill.
- **Lane B — Cinematic footage (FreshPress Pro):** the film is real generated video,
  scrubbed on a canvas — the signature look. It requires the Pro footage pack **and**
  the user's own video-engine account and credits.

**Lane-B unlock probe (run this in STEP 0, before offering lanes):** check whether
`src/paid/skills/brand-studio-footage/LANE-B.md` exists in this checkout (`ls` it).
If present, Lane B is available — read that file and everything it references before
any Lane B work; it is the law for that lane. If absent, Lane B requires FreshPress
Pro — say so once, offer Lane A (which is always a gorgeous result, not a consolation
prize), and never attempt footage generation without the pack.

---

## TWO MODES — build a site, or embed into one

**Ask first: "Do you already have a website you want this in, or are we building the
page from scratch?"** This decides everything downstream.

- **Full-site mode** — no existing site: run the complete process below unchanged. The
  film IS the page.
- **EMBED MODE** — the user has a website (a repo, an export from a design tool, a live
  page): you are NOT designing a website. You are creating the film and its imagery,
  then embedding them into the site they already have. Their design system rules; you
  obey it.

### Embed Mode contract

1. **Read the site first.** Open their project, extract the real palette, type,
   spacing, and any brand assets (logos, product photography, textures). The film must
   look like it was shot for THIS brand — reuse their imagery whenever possible. If the
   site is managed in FreshPress, pull its StyleGuide (`GET /sites/:siteId/design`) and
   treat it as the source of truth.
2. **Offer exactly three placements**, with a recommendation:
   - **Scroll-scrub hero** — the film scrubs with the visitor's scroll at the top of
     the page. The signature look.
   - **Autoplay loop background** — a short seamless loop behind the hero: muted,
     autoplaying, with a poster still.
   - **Its own section** — a full-bleed cinematic section between two existing
     sections, playing on scroll-in.
3. **Pick the lane.** Pro pack present + user has an engine → Lane B rules apply (see
   the pack). Otherwise Lane A pure-code motion built from their existing imagery.
4. **Embed without collateral damage.** Touch only what the placement needs: the new
   section/hero markup, the motion or loop runtime, a poster fallback, and a reduced
   `prefers-reduced-motion` path. Do not restyle, rewrite, or "improve" the rest of
   their site. Mobile gets the poster still or a lighter loop, never a heavy scrub.
5. **Hand back a diff-sized change**: list exactly which files you touched and how to
   revert.

---

## THE GOLDEN RULE — design is done by the best model available, and never delegated

**Run this skill on the strongest model you have access to, at the highest effort setting
it offers**, and keep every taste-bearing decision on that model: concepts, art direction,
palette, type, layout, motion design, copy, the build itself (all HTML/CSS/JS), and the
final design review.

If you are running on a fast or cheap tier, stop and switch before you start. The output
of this skill is judged as a premium website, and no amount of process rescues a design
made by a model that was picked for speed. Likewise if the harness exposes an effort or
reasoning dial, put it at the top — this is a long, taste-heavy build, not a lookup.

Delegate only two things, and never the design:

- **Mechanical work** → pure shell/code with *no model at all* (verification, frame
  work, deploys).
- **Bounded drafting** → fresh sub-agents (drafting one section, acting as the
  adversary in STEP 1). Same model is fine; what makes a sub-agent useful is fresh
  context, not different weights.

**Every brand gets its own page.** Do not reskin a site you built earlier in the session —
same structure, same beat positions, same chrome, new colours. That is the single fastest
way to produce two mediocre sites instead of one good one, and it is invisible to every
gate in this skill because both copies pass identically. It has shipped before: two
builds by the same model shared 15 of 15 JavaScript functions, 14 element ids and 12 of
15 CSS selectors, and the second one was rightly called worthless. The engine is shared
infrastructure and should be; the page is not.

---

## STEP 0 — The interview

Run the Lane-B unlock probe first (top of this file), then ask these up front (batch
them; prefer the host's structured-question UI if available). **Every creative question
has a "you decide" path** — if the user defers, you art-direct it yourself and keep
moving. Never block on a design answer you can make well.

0. **Existing website, or from scratch?** If they have one → **EMBED MODE** (see the
   contract above): also ask which placement they want and where the project lives.
1. **What are we building, and the one-line vibe?**
   Brand/product name, what it is, and the feeling. (e.g. *"VOLTA — an electric race
   team. Aggressive, electric, fast."*)
2. **Brand assets, or should I create the world?**
   Existing logo / colours / fonts / real images — or full creative freedom.
3. **The journey — the one continuous shot, top to bottom.**
   Where the camera starts and where it ends — the *transformation*. (e.g. *"moonlit
   field → into a single bloom → a drop of gold → the bottle."*) Or: "design the arc
   from my brand." **This is the heart of the whole build.**
4. **Real video, or pure motion?** → picks Lane B or Lane A. Lane B is only offered
   when the Pro pack is present AND the user has a video engine (the pack details the
   engine questions). If unsure or zero-setup, default to **Lane A (pure-code)**.
5. **What comes after the film?** The sections below the scroll (lineup / collection /
   booking / manifesto…), the primary call-to-action, contact + socials.
6. **Is this site managed in FreshPress?** If yes (or it should be): get the running
   app's URL + owner auth, and plan the handoff (`references/freshpress-handoff.md`) —
   the brand you art-direct will become the site's StyleGuide, and the finished page
   will be ingested for client-safe editing.
7. **Where does it go live?** Local only, or publish to *their own* hosting (e.g.
   Vercel).

---

## STEP 1 — Pitch concepts back (before building anything)

From the interview, develop **2–3 named creative concepts** and pitch them. Rules:

- Lead with your **recommended** concept, explicitly marked "(Recommended)".
- Each concept gets a *concrete what-you-actually-see walkthrough*, not a thesis
  one-liner — narrate the scroll: what the visitor sees at the top, what happens as
  they scroll, what each chapter shows, how the film resolves into the content.
  (e.g. *"You open on a moonlit flower field, huge serif wordmark floating over it.
  Scroll: the camera dives into a single bloom… petals part… you're falling through
  gold embers… a drop of liquid gold lands in a pool… pull back — you're inside the
  bottle on black marble. The page then melts into the collection."*)
- Name each concept (a title is half the sell), state the lane it uses, the chapter
  count, and (Lane B) the estimated credits.
- **Adversarial sparring on the concepts — MANDATORY, never skipped.** Before presenting,
  the concepts get attacked by something that did not write them. **Default to a fresh
  sub-agent** (the Task tool) — same model is completely fine. A second frontier-model CLI
  is a nice-to-have, not a requirement; if one is slow or fails once, kill it and fall
  back to the sub-agent. Never loop on this step — that has cost a whole build. What
  makes the critique real is fresh context, not different weights: the adversary is given
  the concepts and the brand only, never your reasoning, never which one you prefer, and
  never the fact that you wrote them. Ask it to (a) attack each concept — is the journey
  legible? memorable? feasible in N chapters? does the transformation actually transform,
  or is it four unrelated scenes in a row? — and (b) propose one wildcard angle you
  haven't considered. Fold what survives into your pitch (credit the sparring in one line).
  **This is strategy critique only — the sparring partner never writes copy, code, or any
  design decision; you arbitrate and you author.**
  *A model reviewing its own freshly-written work inside the same context is not a review —
  it defends what it just argued for. A `self-review.json` in the verdicts folder means the
  gate did not run.*
- Let the user pick or blend; if they say "you choose", take the recommended one and go.

Only after a concept is chosen do you build.

---

## STEP 2 — Art-direct the world (you, alone)

Decide and commit: palette (exact hexes), a display+body **type pairing** with real
character (never default system fonts — reach for expressive display faces), a logo
lockup (inline SVG, saved as `assets/logo.svg`), the motion feel, and the chapter
names. Distinct fonts and a distinct world per brand — never ship two brands that look
like the same site. Pull real brand logos as inline SVG for any named third-party tool
(never a hand-drawn approximation of a real logo — see `references/finishing.md` §4).

## STEP 2b — Emit the brand as a DESIGN.md

Immediately after art direction, write the brand into a `DESIGN.md` following
`templates/DESIGN.template.md` **exactly** — the template's conventions are a machine
contract, not a style suggestion: FreshPress parses this file into the site's
StyleGuide, and hex order, `fontFamily:` lines, and section headings are all
load-bearing. The rules and the reasoning live in `references/freshpress-handoff.md`.
Emit it even if the user hasn't decided on FreshPress yet — it costs a minute and
makes the brand portable.

---

## LANE A — Pure-code (free, default)

Write a single self-contained HTML page from scratch for this brand. Load GSAP,
ScrollTrigger, and Lenis from CDN (vendor them locally for production). Compose the
film from the motion vocabulary in `references/engine.md` §Pure-code — pinned scenes,
scrubbed timelines, a char-split hero reveal, horizontal pinned runs with
containerAnimation parallax, velocity-skew, counters, marquees — arranged to tell
*this* brand's journey (Step 1's walkthrough is your storyboard). Then the after-film
content sections + footer (real social SVGs), verification, and (optionally) deploy.

Critical ordering law: **create ScrollTriggers for ambient/background effects AFTER
pinned scenes** — creation order is refresh order; violating this silently mis-positions
everything after a pin spacer.

---

## LANE B — Cinematic footage (FreshPress Pro)

Available only when the unlock probe found the Pro footage pack. Everything about this
lane — the required video model, single-take-first law, storyboard vector rules,
chaining contract, junction/continuity gates, frame-payload math, the scrub engine, and
cost discipline — lives in the pack:

- `src/paid/skills/brand-studio-footage/LANE-B.md` — read it in full before any
  footage work
- its `references/playbook.md` (footage law) and `references/scrub-engine.md` (the
  canvas scrub engine the page is built on)
- its `scripts/` (chaining, assembly, continuity/vector gates)

In one paragraph, for context when the pack is absent: Lane B storyboards the chosen
concept as one continuous camera journey, generates it on the **user's own**
image-to-video engine (BYO account and credits — never a platform key), gates every
seam and the whole film with measured SSIM checks, extracts frames at the film's native
rate, and builds the page around a canvas scrub engine. It is the signature look, and
it is opt-in Pro because the footage pipeline carries real per-generation costs.

---

## THE DELEGATION MODEL (how tokens stay low)

You are the orchestrator and the designer. Spend frontier tokens only where taste lives.

| Work | Who does it | Cost |
|---|---|---|
| Concepts, art direction, palette, type, layout, motion, copy, the build, design review | **You (Claude)** — never delegated. Run design on the strongest model available. | frontier, worth it |
| Concept sparring — attacking the pitch, one wildcard angle | Fresh sub-agent (or a second frontier CLI if present) — strategy text only, never design | one cheap call |
| Drafting bounded pieces (one after-film section; Lane B chapter prompts) | Sub-agents, fanned out in parallel | cheap, parallel |
| Verification, screenshots, deploys (and Lane B frame/SSIM work) | **Pure shell — no model** (`scripts/*`, puppeteer, vercel) | ~free |

Fan out independent pieces concurrently; keep the taste-bearing spine on yourself.

---

## VERIFY (both lanes)

Implement the dev contract in every build: `?jump=<scrollY>` lands pre-scrolled with all
scroll state force-settled, and `window.__ready = true` fires only once the page is truly
ready. Then `scripts/verify.cjs` (puppeteer-core + system Chrome) screenshots any scroll
position and runs the **jank test** (per-frame rAF deltas — judge p95/max, *never*
average fps; target max < 50ms). Screenshot every beat. Never ask the user to eyeball
what you can prove. Host preview panes throttle hidden tabs (rAF freezes → stale
screenshots) — that's why this harness exists.

**Never run a preview server in the foreground.** It never exits, so the tool call blocks
until the whole turn is killed — an agent that does this loses the entire build with no
error message, only a truncated transcript. Always `nohup … &`, then poll the port with
curl, and `pkill` it when finished. The same goes for any long-running process.

**Then `node scripts/copy-gate.cjs site/index.html` — it must exit 0 before you ship.**
Free, deterministic, no model. It fails the build if the page narrates its own concept
at the visitor ("How to read this page", "as you scroll the frame narrows", "one
continuous descent"), if placeholder text survived, or if a hand-drawn `<svg>` stands in
for a real brand logo. A page that captions its own mechanic has described the brief
instead of performing it — the most common way a build passes every mechanical check and
is still obviously not a website. Fix the copy; never silence the gate.

**The harness is evidence, not truth — always look at the pixels too.** It has failed
in both directions on real builds: full marks on a page that rendered as a black void,
and 3/7 with "no visible text" on a page that a direct probe measured at 60 visible
text elements. Treat a surprising score — good or bad — as a claim about the harness
until a screenshot agrees with it. Two cheap habits catch both failures: read
`window.__ready`, the canvas dimensions and a visible-element count directly, and
capture one screenshot at the top and one mid-scroll (`scripts/shot.cjs`). Note also
that a missing `/favicon.ico` is enough to fail `console-errors`; ship a favicon or
discount that single 404.

**Grade the transformation, not the beats.** Screenshots at 0% and 100% must be
recognisably the *same journey's* start and end — the protagonist carried through, not
swapped. If you can reorder two chapters without the page reading as broken, it is not
one continuous shot; it is a stack of sections and the build has failed its premise.

---

## STEP 7 — The FreshPress handoff (the brand outlives the page)

When the site is (or will be) managed in FreshPress, run the handoff recipe in
`references/freshpress-handoff.md`:

1. Create the site (`POST /sites`) if it doesn't exist.
2. Upload `assets/logo.svg` via `POST /sites/:siteId/media/upload` → durable URL. Email
   clients (Gmail, Outlook desktop) don't render SVG, so also render a PNG —
   `node scripts/verify.cjs logo assets/logo.svg assets/logo.png` — and upload it too.
3. Import the brand: `POST /sites/:siteId/design/import` with the emitted DESIGN.md and
   both logo URLs (`url` = the SVG, `rasterUrl` = the PNG) → the StyleGuide is saved,
   and blog render, social images, media generation, and branded email all inherit
   this brand from now on.
4. After the page ships, serve or deploy it so every asset URL is **absolute**, then
   ingest it (`POST /sites/:siteId/pages/ingest {url}`) — the motion runtime freezes
   into the template and the text/CTAs become client-safe editable slots.

Order matters only in one place: import the design **before** ingesting, so the site's
brand exists the moment the page does.

---

## DEPLOY (opt-in, their hosting)

Build a **lean** copy first — `index.html` + vendored libs (dereference symlinks with
`cp -RL`) + only the runtime assets. Never upload build intermediates. Then (e.g.)
`vercel deploy --prod --yes` from the lean dir. Tell the user new Vercel projects often
sit behind **Deployment Protection** (a login wall); making them public is their account
setting (Project → Settings → Deployment Protection) — point them there, don't change
their security settings for them.

---

## GUARDRAILS

- **This skill ships with zero personal data** — no API keys, no accounts, no personal
  paths. Every user brings their own accounts (video engine, hosting, FreshPress
  instance). Never bake credentials in, never commit keys.
- Design + build stay on Claude. Mechanical work goes to code; design never does.
- Lane B only with the Pro pack present, only on the user's own engine account, and
  only after confirming costs (the pack's cost-discipline rules).
- One continuous shot; one world per brand; no visible seams; no dissolve masking.
- Respect `prefers-reduced-motion` in every build.
- **The concepts always get attacked by something that didn't write them** (Step 1) —
  never skipped, never self-review.
- Reference files: `references/engine.md` (Lane A motion vocabulary + shared page
  mechanics), `references/finishing.md` (**the craft that decides whether it looks
  expensive**), `references/freshpress-handoff.md` (DESIGN.md contract + handoff),
  `templates/DESIGN.template.md`, `scripts/verify.cjs`, `scripts/shot.cjs`,
  `scripts/copy-gate.cjs` (deterministic copy gate — must exit 0 to ship).

## OPERATIONAL TRAPS (each of these cost a real build)

- **Never run a preview server in the foreground.** It never returns, the turn dies, and
  the whole build is lost with no error. `nohup … &`, poll with curl, `pkill` after.
- **Never let two writers touch one file.** If a human or another agent is editing the
  page you are editing, stop one of them first. Interleaved writes corrupt silently.
- **A long autonomous build will hit context compaction.** Instructions given in chat are
  summarised away; a written `BRIEF.md` in the project directory survives. Put the asset
  paths, key constants and the do-nots in the file, not in the conversation.
- **Stale to-do lists outlive corrections.** After compaction an agent resumes whatever its
  checklist says, so correct the checklist, not just the conversation.
- **Download from a CDN with a browser User-Agent** and **persist job ids to disk the
  moment they are issued** — a failed download after a paid render is otherwise
  unrecoverable and costs the render twice.

## Credits

- Jack Robert's: https://www.skool.com/ai-automation-vault/about

This skill is adapted from the **scroll-film-studio** skill credited above, shared
freely by its author for any use. The FreshPress adaptation (two lanes, embed mode,
DESIGN.md emission, and the FreshPress handoff) builds on that original process.
