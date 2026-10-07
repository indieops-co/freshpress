# FreshPress handoff — the brand outlives the page

The site you build is one artifact; the brand is the durable one. This file is the
contract for getting the art-directed brand INTO FreshPress as the site's StyleGuide
(so blog rendering, social images, media generation, and branded email inherit it) and
getting the finished page in as a client-safe editable template.

Prerequisites: a running FreshPress app the user owns, and owner auth (the editor's
session token, or however the user normally authenticates API calls). Never store or
commit credentials.

---

## 1. Emit DESIGN.md (STEP 2b — do this even before the handoff)

Fill `templates/DESIGN.template.md` for the brand. The template's inline comment lists
the three machine rules; here is *why* they exist, so you don't "improve" them away:

- **Hex order is positional.** The fallback parser (`parseDesignMdHeuristic`) assigns
  the first six unique hexes in the document to primary, secondary, accent,
  background, surface, text — in order of first appearance. A stray hex in section 1
  shifts every assignment by one. Keep all hexes out of the file until the Section 2
  palette list, and keep that list in role order. All eleven roles should still be
  listed (the AI parse path reads them as prose); only the first six are positional
  insurance for the no-AI fallback.
- **`fontFamily:` lines are the only font signal** the fallback parser sees (first
  match = heading, second = body, `/mono/i` = mono). The human-readable "Heading
  font:" bullets are for the AI path and for people; the fontFamily lines are for the
  machine. Ship both.
- **Sections 7 and 9 become prompt text verbatim.** `## 7. Do's and Don'ts` (and, as
  backup, `## 9. Agent Prompt Guide` / `## 1. Visual Theme…`) are extracted into
  `designRules` / `aiSystemPromptAddition` — deterministically, markup-stripped, and
  injected into future generation prompts for this site. Write them as guardrails you
  want an AI to obey, not as marketing copy.
- **Sections 1–6 must sit inside the first 12k characters** — the AI parse slice.
  If the file runs long, trim prose, never reorder.
- The `## Logo` section is informational (the logo travels as an uploaded asset +
  StyleGuide pointer, not through the parser) — keep it for humans and for embed-mode
  re-reads.

## 2. Create the site (if it doesn't exist)

```
POST {app}/sites            { "name": "<brand name>" }        → { site: { id } }
```

## 3. Upload the logo (SVG + a PNG for email)

```
node scripts/verify.cjs logo assets/logo.svg assets/logo.png   # transparent, 80px tall

POST {app}/sites/:siteId/media/upload      (multipart, file=assets/logo.svg)
                                            → { publicPath }
POST {app}/sites/:siteId/media/upload      (multipart, file=assets/logo.png)
                                            → { publicPath }
```

SVG passes the image filter. Keep both returned `publicPath`s — they are the durable
URLs the StyleGuide will point at. The PNG exists for branded email: Gmail and Outlook
desktop don't render SVG, so email never uses the SVG — without the PNG the email
header falls back to the brand name as text. (80px is 2× the email header's logo
height, so it stays crisp on retina screens.)

## 4. Import the brand

```
POST {app}/sites/:siteId/design/import
{
  "rawDesignMd": "<the full DESIGN.md text>",
  "name": "<brand name>",
  "aesthetic": "<one-line vibe from the interview>",
  "logo": {
    "url": "<SVG publicPath from step 3>",
    "alt": "<brand> logo",
    "rasterUrl": "<PNG publicPath from step 3>"
  }
}
```

Both logo URLs must be this site's own upload paths exactly as returned
(`/media/<siteId>/wp-content/uploads/<file>`) — anything else is rejected with a 400.

This parses the DESIGN.md into the site's StyleGuide and makes it live. From this
moment blog render, social images, media-gen prompts, and branded email all speak this
brand. Verify with `GET {app}/sites/:siteId/design` — check the palette and fonts came
through exactly (if the app has no AI key configured, the heuristic fallback ran; the
positional rules above are what make that path safe).

**Import the design BEFORE ingesting the page** — the site's brand should exist the
moment the page does.

## 5. Ingest the finished page

FreshPress ingest fetches a URL and freezes the page as a template, turning text,
links, buttons, and images into client-safe editable slots. Two consequences:

- **Every asset URL must be absolute at ingest time.** Ingest does not rewrite
  relative URLs, so a page referencing `frames/f_0001.jpg` or `assets/logo.svg`
  relatively will break when served from FreshPress. Deploy first (Vercel step) or
  serve locally with absolutized URLs, then ingest the served page.
- The motion runtime (GSAP/Lenis or the scrub engine) freezes into the template
  as-is — which is exactly right: clients edit copy and CTAs, never the film.

```
POST {app}/sites/:siteId/pages/ingest      { "url": "https://<deployed page>" }
```

Then open the page in the FreshPress editor and confirm the headline, beat copy, and
CTAs appear as editable slots.

## 6. Tell the user what's wired

Close the handoff by listing, concretely: the StyleGuide id, the logo URL, which
downstream surfaces now inherit the brand (blog, social, media-gen, email), and where
the ingested page lives in their dashboard.
