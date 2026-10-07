# Brand Studio — premium branded websites, built by your coding agent

Brand Studio is an **agent skill**, not an app feature: an agency runs it in Claude
Code (or any harness that loads skills) inside their FreshPress checkout. It
interviews you, pitches 2–3 named creative concepts, art-directs a complete brand
world — palette, expressive type pairing, logo lockup — and then builds a bespoke
**scroll-film website**: the whole page is one continuous cinematic shot that plays as
the visitor scrolls. The brand it creates is then imported into FreshPress as the
site's StyleGuide, so blog rendering, social images, media generation, and branded
email all inherit it.

## The two lanes

| | Lane A — Pure-code | Lane B — Cinematic footage (Pro) |
|---|---|---|
| The film | GSAP + Lenis scroll motion | Real generated video, scrubbed on canvas |
| Setup | None | FreshPress Pro + your own video-engine account |
| Cost | Free | Your own Higgsfield/Kie.ai credits (quoted before any spend) |
| Availability | Ships with the free core | Ships in the Pro overlay (`src/paid/`) |

Lane A is not a consolation prize — it is a designed, verified, cinematic page.
Lane B is the signature look: a one-take film shot on Seedance-class image-to-video
models, gated by measured continuity checks.

**No keys, ever.** Neither lane ships credentials. Lane B uses your own Higgsfield
CLI login or a `KIE_API_KEY` you provide; the skill quotes the credit cost of every
generation and waits for your yes.

## Install (one line)

From your FreshPress checkout root:

```bash
mkdir -p .claude/skills && ln -s ../../ref/skills/brand-studio .claude/skills/freshpress-brand-studio
```

(Windows: copy the folder instead of symlinking.) Then ask your agent for a
"branded website" / "brand studio" build. Pro buyers: the footage pack lands at
`src/paid/skills/brand-studio-footage/` when the Pro overlay is installed — the base
skill detects it and unlocks Lane B automatically.

## What you get

1. **A brand**: exact palette, display+body type pairing, logo lockup SVG, motion
   feel — every brand distinct, never a reskin.
2. **A DESIGN.md**: the brand written as a machine-readable design contract.
3. **A live StyleGuide**: the skill imports the DESIGN.md via
   `POST /sites/:siteId/design/import` (with the logo uploaded as a media asset), and
   the site's whole downstream brand surface updates.
4. **The site**: a one-page scroll-film (or, in embed mode, a cinematic hero/section
   added to an existing site without redesigning it), verified by deterministic gates
   (copy gate, jank test, screenshot harness) before it ships.
5. **Client-safe editing**: the finished page is ingested
   (`POST /sites/:siteId/pages/ingest`) so clients can edit headlines and CTAs while
   the film and design stay locked.

## The design import endpoint

Brand Studio's handoff uses a small public API you can also use directly:

```
POST /sites/:siteId/design/import        (owner auth)
{
  "rawDesignMd": "<full DESIGN.md text>",
  "name": "Brand name",
  "aesthetic": "one-line vibe",             // optional
  "logo": {                                 // optional — this site's /media/upload paths only
    "url": "/media/<siteId>/wp-content/uploads/<file>.svg",
    "alt": "…",
    "rasterUrl": "/media/<siteId>/wp-content/uploads/<file>.png"   // optional PNG for email
  }
}
```

Branded email never uses an SVG logo (Gmail and Outlook desktop don't render SVG): it
uses `rasterUrl` when present and otherwise shows the brand name as text.

It parses the DESIGN.md into a StyleGuide (AI-assisted when a provider key is
configured, deterministic heuristic otherwise) and activates it for the site — same
semantics as applying a vendored theme. The emission conventions that make the
heuristic path reliable are documented in
`ref/skills/brand-studio/references/freshpress-handoff.md`.
