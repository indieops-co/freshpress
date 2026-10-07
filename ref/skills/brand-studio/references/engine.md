# Engine recipes — how to build the page

Not a template. These are the load-bearing mechanics you write *into* each bespoke
build. Everything else — markup, styling, motion shape, copy — you design fresh per
brand.

Lane B's canvas scrub engine (frames, ImageBitmap window, payload math) lives in the
Pro footage pack: `src/paid/skills/brand-studio-footage/references/scrub-engine.md`.
Everything below applies to both lanes unless marked.

---

## Beat overlays (copy over the film)

> **The world brief is production notes, not source copy.**
>
> This is the single most reliable way to ruin a finished build. A brief describes the
> film in vivid prose *because it is written for whoever creates the visuals*. A model
> with no other source of imagery in the room paraphrases that prose straight onto the
> page as beat copy, and ships a shot list:
>
> > "through the cola. past the bubbles." · "the glass. looking up."
> > "everything before was descent. everything after is retreat."
>
> That last line came almost verbatim from a real brief, and the owner's reaction was
> that the text "is literally the prompt describing what it does". He was right.
>
> **The test:** someone who cannot see the film at all must still read every line as
> advertising for the product. If a line only makes sense next to the picture, it is
> a caption, and captions are what the picture is for.
>
> Never name the camera's position, direction, or what it is passing. No *descent*,
> *pull back*, *looking up*, *one continuous take*, no listing what is in frame. The
> beats carry what the picture cannot: the claim, the refusal, the joke.
> `scripts/copy-gate.cjs` fails all of these — run it, never edit it to pass.

Absolute-positioned overlays with progress envelopes, driven from the same tick as the
film (Lane B) or the master scroll progress (Lane A):

```html
<div class="beat" data-in="0.16" data-peak="0.235" data-out="0.31"><h2>…</h2></div>
```
```js
function beatAlpha(b, p){
  if (p < b.in || p > b.out) return 0;
  if (p < b.peak) return (p - b.in) / Math.max(1e-4, b.peak - b.in);
  if (b.out > 1.5) return 1;                    // finale: data-out="2" never fades
  return 1 - (p - b.peak) / Math.max(1e-4, b.out - b.peak);
}
// alpha → style.opacity, plus a small translateY against scroll direction
```

Hero beat must be visible at scroll 0: `data-in="-0.1" data-peak="0"`. If the finale
frame is a centred product/subject, anchor the finale panel to the left so the subject
stays hero.

## Adaptive header (fixed chrome over a changing page)

Sample the backdrop under the header every ~180ms (Lane B: the drawn frame's top strip
into a 16×4 offscreen canvas; Lane A: the active scene's declared luminance), average
luminance, toggle an `.on-light` class (threshold ≈ 138). All header colours run through
`currentColor` so one class flips everything. A **chapter readout** (label + thin
progress bar) doubles as narrative and progress UI — or theme it (e.g. a live altimeter
counting down as the journey descends).

## Seam handoff (film → content, no visible line)

Sample (Lane B) or choose (Lane A) the film's final backdrop colour. Start the next
section's background **at exactly that hex**, and add a bottom-fade overlay on the film
stage that ramps in over the last ~8% of progress (`(p - 0.92) / 0.08`). Fade any grain +
vignette out with the same ramp. If the film ends dark and the content is light, build a
tall gradient "landing zone" that melts dark → brand-light over the first content block.

## Ambient hero layer (optional, free, sells the opening)

Themed canvas particles (snow glisten, gold pollen, embers) over the static opening,
fading out across the first ~7% of scroll: one 32px offscreen radial-gradient sprite,
`drawImage` per particle with per-particle depth (size/speed/alpha), sin-based twinkle or
glow pulse. Never `shadowBlur` (expensive). Stop rendering entirely once alpha hits 0.
Skip under `prefers-reduced-motion`.

## The dev contract (verification hooks — implement in every build)

```js
const JUMP = new URLSearchParams(location.search).get('jump');
if (JUMP !== null) history.scrollRestoration = 'manual';   // and skip smooth-scroll init
// after everything is loaded and settled:
if (JUMP !== null){ scrollTo(0, +JUMP || 0); /* recompute progress, draw, tick once */ }
window.__ready = true;
```

`?jump=<y>` must land pre-scrolled with all scroll-driven state force-settled (for
pure-code builds: `ScrollTrigger.update()` then set each scrubbed animation's
`totalProgress` explicitly). `__ready` gates the screenshot harness. Hide any
cursor-follower until the first real `mousemove` or it photobombs captures at (0,0).

Jank meter for the console: track per-frame rAF deltas, log `max` every 2s. Judge p95/max,
never average fps — a 60fps average hides 80ms decode spikes perfectly.

---

## Pure-code film (Lane A) — the motion vocabulary

The "film" is a sequence of scroll-driven scenes. Wire Lenis into GSAP's ticker:

```js
const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
```

Vocabulary to compose from (pick what tells *this* brand's journey):
- **Char-split hero reveal** — split the wordmark into spans, stagger `yPercent:120 → 0`
  with `power4.out`.
- **Pinned scrubbed scenes** — `pin: true, scrub: true, end: '+=140%'` timelines
  (a growing/rotating form, a blend "vortex", a mask opening to full-bleed).
- **Horizontal pinned run** — translate a `width:max-content` track by
  `-(scrollWidth - innerWidth)`; give child elements their own parallax via
  `containerAnimation`. Use `invalidateOnRefresh: true`.
- **Clip-path reveals** — `inset(0 0 100% 0) → inset(0)` on scroll for editorial rows.
- **Velocity-skew** — skew a ticker/marquee by `ScrollTrigger.getVelocity()` clamped.
- **Counters** — `once: true` triggers with `snap: { textContent: 1 }`.
- **Marquee drift** — `xPercent: -50, repeat: -1` on a doubled row.

**Ordering law (silent killer):** ScrollTriggers are refreshed in *creation order*.
Create all pinned scenes **first**, ambient/background triggers **after** — otherwise
positions computed before pin spacers exist are silently wrong (effects fire thousands
of pixels early).

Performance: GPU-only properties (transform/opacity), `will-change` on the few moving
nodes, no layout-thrashing reads in tickers. Same dev contract + jank meter as Lane B.
