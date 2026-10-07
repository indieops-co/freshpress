<!--
  FreshPress Brand Studio — DESIGN.md template.
  This file is a MACHINE CONTRACT consumed by FreshPress's DESIGN.md parser
  (src/design/parse-design-md.ts). Follow references/freshpress-handoff.md while
  filling it in. The three load-bearing rules, violated at your peril:

  1. HEX ORDER. The first SIX unique hex codes in the whole document are assigned
     positionally: 1st=primary, 2nd=secondary, 3rd=accent, 4th=background,
     5th=surface, 6th=text. Do NOT put any hex anywhere in the file before the
     palette list below, and keep the list in exactly this role order. (Repeats of
     an already-listed hex are safe — extraction de-duplicates.)

  2. FONTS. The parser reads fonts ONLY from `fontFamily:` lines (YAML-style key,
     colon touching the word). First match = heading font, second = body font; a
     stack whose first name contains "Mono" becomes the mono font. Prose like
     "Heading font: Fraunces" is invisible to the fallback parser — keep the
     fontFamily lines.

  3. RULE SECTIONS. "## 7. Do's and Don'ts" and "## 9. Agent Prompt Guide" are
     extracted VERBATIM into the StyleGuide's generation guardrails
     (designRules / aiSystemPromptAddition). Write them as prompt-safe plain
     prose — no HTML, no code fences, nothing you wouldn't want prepended to
     every image/UI generation prompt for this brand.

  Keep sections 1–6 inside the first 12,000 characters (the AI parse path reads
  only that much). Replace every [bracketed] placeholder; delete this comment.
-->

# [Brand Name] Design System

## 1. Visual Theme & Atmosphere

[2–4 sentences: overall mood, design philosophy, density, visual character, and the
signature visual element this brand will be remembered by. NO hex codes in this
section — the first hexes in the file must be the palette below.]

## 2. Color Palette & Roles

- **[Primary Name]** — `#RRGGBB` — Primary. [where it leads: CTAs, wordmark, key moments]
- **[Secondary Name]** — `#RRGGBB` — Secondary. [supporting surfaces/roles]
- **[Accent Name]** — `#RRGGBB` — Accent. [highlights, hover, small moments of heat]
- **[Background Name]** — `#RRGGBB` — Background. [the page canvas]
- **[Surface Name]** — `#RRGGBB` — Surface. [cards, panels, raised planes]
- **[Text Name]** — `#RRGGBB` — Text. [primary reading color on the background]
- **[Text-muted Name]** — `#RRGGBB` — Text-muted. [captions, metadata]
- **[Border Name]** — `#RRGGBB` — Border. [hairlines, dividers]
- **[Success Name]** — `#RRGGBB` — Success.
- **[Warning Name]** — `#RRGGBB` — Warning.
- **[Error Name]** — `#RRGGBB` — Error.

## 3. Typography Rules

- Heading font: [Display Face Name]
  fontFamily: "[Display Face Name], [fallback], serif"
- Body font: [Body Face Name]
  fontFamily: "[Body Face Name], [fallback], sans-serif"
- Mono font (optional):
  fontFamily: "[Mono Face Name] Mono, monospace"

| Level | Size | Weight | Notes |
|---|---|---|---|
| display-lg | [size] | [weight] | [hero wordmark treatment] |
| display-md | [size] | [weight] | |
| h1 | [size] | [weight] | |
| h2 | [size] | [weight] | |
| h3 | [size] | [weight] | |
| h4 | [size] | [weight] | |
| body-lg | [size] | [weight] | |
| body | [size] | [weight] | |
| body-sm | [size] | [weight] | |
| caption | [size] | [weight] | |
| label | [size] | [weight] | [tracking/transform if any] |

## 4. Component Styling

- **Buttons** — primary: [bg/text/radius/padding + resting glow / hover sweep];
  secondary: [outline|ghost|soft]; CTA: [the most confident element on the page —
  treatment].
- **Cards** — [background, border, radius, shadow, padding].
- **Navigation** — [floating|sticky|static|full-width], [background, text color].
- **Hero** — [centered|split-left|split-right|full-bleed], [headline treatment],
  [CTA count].
- **Footer** — [minimal|full|dark-band], [background].
- [How the signature element carries through components.]

## 5. Layout Principles

[Spacing scale, max container width, grid columns, whitespace philosophy.]

## 6. Depth & Elevation

[Shadow system — sm, md, lg, glow — and surface hierarchy.]

## Logo

- Asset: `assets/logo.svg` — [one-line description of the lockup]
- Alt text: "[brand name] logo"
- [Clearspace / minimum size / single-color variant notes.]

## 7. Do's and Don'ts

Do:
- [5–8 guardrails specific to THIS brand, concrete enough to settle a real design
  argument — name the exact colors, treatments, or scales each one protects.]

Don't:
- [The inversions — what must never happen to this brand.]

## 8. Responsive Behavior

[Key breakpoints, touch targets, collapsing strategy. Mobile is a deliverable, not a
fallback.]

## 9. Agent Prompt Guide

[2–3 sentences of brand voice an AI agent can prepend to any image or UI generation
prompt for this brand. Plain prose, prompt-safe.]
