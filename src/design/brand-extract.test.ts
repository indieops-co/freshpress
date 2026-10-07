import { describe, it, expect } from 'vitest';
import {
  collectBrandEvidence,
  evidenceToExtractedBrand,
  mapFirecrawlBranding,
  buildNormalizePrompt,
  parseNormalizedBrand,
  mergeExtractedBrand,
  extractedBrandToStyleGuidePatch,
  sourceFromExtraction,
  emptyExtractedBrand,
  ExtractedBrandSchema,
  type ExtractedBrand,
} from './brand-extract.js';
import { buildDefaultStyleGuide } from './style-guide.js';
import { validateStyleGuideChange } from '../guardian/validate-style-guide.js';
import type { DesignIntakeInput } from './generate-design-md.js';

// A realistic marketing-page <head>/<body> snippet: real Google Fonts link syntax,
// CSS custom properties in a <style> block, inline font-family, og:logo + favicon,
// and a logo <img>. Fixture mirrors real markup, not a simplified stand-in.
const PAGE_HTML = `<!doctype html><html><head>
  <title>Acme Analytics</title>
  <meta name="theme-color" content="#5b21b6">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&family=Inter:wght@400;500&display=swap">
  <meta property="og:logo" content="/assets/acme-logo.svg">
  <link rel="icon" href="/favicon.ico">
  <style>
    :root { --brand-primary: #5b21b6; --brand-accent: #f59e0b; --ink: #111827; }
    .hero { background: #5b21b6; color: #ffffff; font-family: "Poppins", sans-serif; }
    .btn { background: #f59e0b; }
    body { color: #111827; font-family: Inter, system-ui, sans-serif; }
  </style>
</head><body>
  <header><img src="/assets/acme-logo.svg" alt="Acme logo" class="site-logo"></header>
  <h1 style="color:#5b21b6">Analytics for builders</h1>
</body></html>`;

describe('collectBrandEvidence', () => {
  const ev = collectBrandEvidence(PAGE_HTML, 'https://acme.example.com/');

  it('reads the theme-color meta', () => {
    expect(ev.themeColor).toBe('#5b21b6');
  });

  it('extracts font families from the Google Fonts link and font-family declarations', () => {
    expect(ev.fontFamilies).toContain('Poppins');
    expect(ev.fontFamilies).toContain('Inter');
    // Generic keywords (system-ui, sans-serif) are dropped.
    expect(ev.fontFamilies).not.toContain('system-ui');
    expect(ev.fontFamilies).not.toContain('sans-serif');
  });

  it('ranks colors by frequency', () => {
    const primary = ev.colors.find((c) => c.value === '#5b21b6');
    expect(primary).toBeDefined();
    expect(primary!.count).toBeGreaterThan(1); // appears in var, .hero bg, inline, theme-color
    expect(ev.colors[0].value).toBe('#5b21b6'); // most frequent overall
  });

  it('resolves the logo to an absolute URL, preferring the logo <img>', () => {
    expect(ev.logoCandidates[0]).toBe('https://acme.example.com/assets/acme-logo.svg');
  });

  it('captures the title', () => {
    expect(ev.title).toBe('Acme Analytics');
  });

  it('extracts a QUOTED font-family declared in CSS with no Google-Fonts link', () => {
    // Regression: the font-family regex used to exclude quote chars, so a quoted name matched only a space.
    const html = `<html><head><style>h1 { font-family: 'Gotham', sans-serif; } body { font-family: "Söhne", system-ui; }</style></head><body></body></html>`;
    const e = collectBrandEvidence(html, 'https://x.test/');
    expect(e.fontFamilies).toContain('Gotham');
    expect(e.fontFamilies).toContain('Söhne');
  });

  it('drops data:/javascript: logo srcs (only http(s) logos survive)', () => {
    const html = `<html><body><img src="javascript:alert(1)" class="logo"><img src="https://x.test/real-logo.png" alt="logo"></body></html>`;
    const e = collectBrandEvidence(html, 'https://x.test/');
    expect(e.logoCandidates.every((u) => u.startsWith('http'))).toBe(true);
    expect(e.logoCandidates).toContain('https://x.test/real-logo.png');
  });
});

describe('evidenceToExtractedBrand (pure, AI-free fallback)', () => {
  it('assigns theme-color to primary and a non-neutral color to accent, with low confidence', () => {
    const ev = collectBrandEvidence(PAGE_HTML, 'https://acme.example.com/');
    const brand = evidenceToExtractedBrand(ev, 'https://acme.example.com/');
    expect(brand.colors.primary).toBe('#5b21b6');
    expect(brand.colors.accent).toBe('#f59e0b');
    expect(brand.typography.headingFont).toBe('Poppins');
    expect(brand.logoUrl).toBe('https://acme.example.com/assets/acme-logo.svg');
    expect(brand.engine).toBe('heuristic');
    expect(brand.confidence.colors).toBeGreaterThan(0);
    expect(brand.confidence.colors).toBeLessThan(0.5);
    expect(() => ExtractedBrandSchema.parse(brand)).not.toThrow();
  });

  it('handles a page with no evidence — a valid empty draft', () => {
    const brand = evidenceToExtractedBrand(collectBrandEvidence('<html></html>', 'https://x.test/'), 'https://x.test/');
    expect(brand.colors).toEqual({});
    expect(brand.confidence).toEqual({ colors: 0, typography: 0, radii: 0, shadows: 0, logo: 0 });
  });

  it('does NOT treat a saturated rgb() color as neutral (regression: rgb(0,122,255) is a real color)', () => {
    // A monochrome page with one saturated blue and no theme-color meta.
    const html = `<html><head><style>.a{color:rgb(0,122,255)}.a2{color:rgb(0,122,255)}.b{color:#000000}.c{background:#ffffff}</style></head><body></body></html>`;
    const brand = evidenceToExtractedBrand(collectBrandEvidence(html, 'https://x.test/'), 'https://x.test/');
    expect(brand.colors.primary).toBe('rgb(0,122,255)');
  });

  it('never leaves accent equal to primary when theme-color is a lower-frequency color', () => {
    // #5b21b6 appears more often, but theme-color meta points at #f59e0b → primary=#f59e0b,
    // accent must be the dominant #5b21b6, not dropped.
    const html = `<html><head>
      <meta name="theme-color" content="#f59e0b">
      <style>.a{color:#5b21b6}.b{background:#5b21b6}.c{border-color:#5b21b6}.d{color:#f59e0b}</style>
    </head><body></body></html>`;
    const brand = evidenceToExtractedBrand(collectBrandEvidence(html, 'https://x.test/'), 'https://x.test/');
    expect(brand.colors.primary).toBe('#f59e0b');
    expect(brand.colors.accent).toBe('#5b21b6');
  });
});

describe('mapFirecrawlBranding', () => {
  // A real api.firecrawl.dev/v2/scrape { formats: ['branding'] } response shape, captured live
  // from stripe.com (trimmed). Colors is a named object with `textPrimary`; fonts live in both a
  // `fonts[]` role list and `typography.fontFamilies`; radius under spacing.borderRadius; the
  // primary button's shadow is "none"; the logo is a data: SVG URI.
  const REAL = {
    success: true,
    data: {
      branding: {
        colorScheme: 'light',
        fonts: [
          { family: 'Sohne', role: 'body' },
          { family: 'SF Pro Display', role: 'heading' },
        ],
        colors: {
          primary: '#0D1738',
          secondary: '#061B31',
          accent: '#533AFD',
          background: '#FFFFFF',
          textPrimary: '#533AFD',
          link: '#533AFD',
        },
        typography: {
          fontFamilies: { primary: 'Sohne', heading: 'SF Pro Display' },
          fontStacks: { heading: ['Sohne', 'Arial', 'sans-serif'], body: ['Sohne'] },
          fontSizes: { h1: '48px', h2: '32px', body: '32px' },
        },
        spacing: { baseUnit: 8, borderRadius: '0px' },
        components: {
          buttonPrimary: { background: '#533AFD', textColor: '#FFFFFF', borderRadius: '4px', shadow: 'none' },
          buttonSecondary: { background: '#FFFFFF', textColor: '#533AFD', borderColor: '#B9B9F9', borderRadius: '4px', shadow: 'none' },
        },
        images: { logo: 'data:image/svg+xml;utf8,<svg/>', favicon: 'https://images.stripeassets.com/favicon.ico', logoAlt: 'Stripe logo' },
        confidence: { buttons: 0.95, colors: 0.9, overall: 0.925 },
      },
    },
  };

  it('maps the confirmed real Firecrawl branding shape (colors incl. textPrimary→text, fontFamilies, spacing.borderRadius, data: logo)', () => {
    const brand = mapFirecrawlBranding(REAL, 'https://stripe.com/');
    expect(brand.engine).toBe('firecrawl');
    expect(brand.colors.primary).toBe('#0D1738');
    expect(brand.colors.secondary).toBe('#061B31');
    expect(brand.colors.accent).toBe('#533AFD');
    expect(brand.colors.background).toBe('#FFFFFF');
    expect(brand.colors.text).toBe('#533AFD'); // from textPrimary
    // Fonts: heading from fontFamilies.heading, body from fontFamilies.primary.
    expect(brand.typography.headingFont).toBe('SF Pro Display');
    expect(brand.typography.bodyFont).toBe('Sohne');
    // Radius from spacing.borderRadius; button shadow "none" is skipped.
    expect(brand.radii.md).toBe('0px');
    expect(brand.shadows.md).toBeUndefined();
    // data: SVG logo is kept (safe for an <img> preview).
    expect(brand.logoUrl).toBe('data:image/svg+xml;utf8,<svg/>');
    // Uses Firecrawl's own confidence numbers.
    expect(brand.confidence.colors).toBe(0.9);
  });

  it('derives fonts from the fonts[] role list when fontFamilies is absent', () => {
    const payload = {
      data: {
        branding: {
          colors: { primary: '#0D1738' },
          fonts: [
            { family: 'Sohne', role: 'body' },
            { family: 'SF Pro Display', role: 'heading' },
          ],
        },
      },
    };
    const brand = mapFirecrawlBranding(payload, 'https://stripe.com/');
    expect(brand.typography.headingFont).toBe('SF Pro Display');
    expect(brand.typography.bodyFont).toBe('Sohne');
  });

  it('drops color values that are not CSS color literals (url() beacons, arbitrary CSS)', () => {
    const payload = {
      data: {
        branding: {
          colors: {
            primary: 'url(https://evil.test/px)',
            secondary: 'red; } .x { background: url(https://evil.test)',
            accent: '#533AFD',
            background: 'rgba(255, 255, 255, 0.9)',
            textPrimary: 'rebeccapurple',
          },
        },
      },
    };
    const brand = mapFirecrawlBranding(payload, 'https://x.test/');
    expect(brand.colors.primary).toBeUndefined();
    expect(brand.colors.secondary).toBeUndefined();
    expect(brand.colors.accent).toBe('#533AFD');
    expect(brand.colors.background).toBe('rgba(255, 255, 255, 0.9)');
    expect(brand.colors.text).toBe('rebeccapurple');
  });

  it('picks a real button shadow (not "none") and falls back to the button radius when spacing has none', () => {
    const payload = {
      data: {
        branding: {
          colors: { primary: '#0D1738' },
          components: { buttonPrimary: { borderRadius: '8px', shadow: '0 4px 12px rgba(0,0,0,0.1)' } },
        },
      },
    };
    const brand = mapFirecrawlBranding(payload, 'https://x.test/');
    expect(brand.radii.md).toBe('8px');
    expect(brand.shadows.md).toBe('0 4px 12px rgba(0,0,0,0.1)');
  });

  it('falls back to an array-of-colors layout and http logo (resilience to response variation)', () => {
    const payload = { data: { branding: { palette: ['#5b21b6', '#f59e0b', '#ffffff'], images: { logo: '/logo.svg' } } } };
    const brand = mapFirecrawlBranding(payload, 'https://acme.example.com/');
    expect(brand.colors.primary).toBe('#5b21b6');
    expect(brand.colors.accent).toBe('#f59e0b');
    expect(brand.colors.background).toBe('#ffffff');
    expect(brand.logoUrl).toBe('https://acme.example.com/logo.svg');
  });

  it('returns an empty-but-valid draft when the payload has no branding', () => {
    const brand = mapFirecrawlBranding({ data: {} }, 'https://acme.example.com/');
    expect(brand.colors).toEqual({});
    expect(brand.confidence.colors).toBe(0);
  });

  it('a garbage color value from Firecrawl is rejected downstream by the real validateStyleGuideChange', () => {
    // The mapper does no value validation, so junk is possible; the apply-time Guardian must catch it.
    const brand = mapFirecrawlBranding(
      { data: { branding: { colors: { primary: 'red;}body{display:none' } } } },
      'https://acme.example.com/'
    );
    const result = validateStyleGuideChange(buildDefaultStyleGuide('x', 'X', 'y'), extractedBrandToStyleGuidePatch(brand));
    expect(result.ok).toBe(false);
  });
});

describe('buildNormalizePrompt', () => {
  it('lists the observed evidence for the model', () => {
    const ev = collectBrandEvidence(PAGE_HTML, 'https://acme.example.com/');
    const { system, user } = buildNormalizePrompt(ev);
    expect(system).toContain('semantic roles');
    expect(user).toContain('#5b21b6');
    expect(user).toContain('Poppins');
    expect(user).toContain('Acme Analytics');
  });
});

describe('parseNormalizedBrand', () => {
  const ev = collectBrandEvidence(PAGE_HTML, 'https://acme.example.com/');

  it('keeps only colors/fonts that appeared in the evidence and backfills the logo', () => {
    const ai = JSON.stringify({
      colors: { primary: '#5b21b6', accent: '#f59e0b', background: '#ffffff' },
      typography: { headingFont: 'Poppins', bodyFont: 'Inter' },
    });
    const brand = parseNormalizedBrand(ai, ev, 'https://acme.example.com/');
    expect(brand.colors.primary).toBe('#5b21b6');
    expect(brand.typography.headingFont).toBe('Poppins');
    expect(brand.logoUrl).toBe('https://acme.example.com/assets/acme-logo.svg');
  });

  it('rejects invented hex/fonts not in the evidence, falling back to the real evidence values', () => {
    const ai = JSON.stringify({ colors: { primary: '#123456' }, typography: { headingFont: 'Comic Sans' } });
    const brand = parseNormalizedBrand(ai, ev, 'https://acme.example.com/');
    // The hallucinated values never appear…
    expect(brand.colors.primary).not.toBe('#123456');
    expect(brand.typography.headingFont).not.toBe('Comic Sans');
    // …and since the AI contributed nothing usable, we fall back to real evidence.
    expect(brand.colors.primary).toBe('#5b21b6');
  });

  it('falls back to evidence mapping on unparseable AI output', () => {
    const brand = parseNormalizedBrand('not json at all', ev, 'https://acme.example.com/');
    expect(brand.colors.primary).toBe('#5b21b6'); // evidenceToExtractedBrand result
  });

  it('parses JSON wrapped in a ```json fence with surrounding prose (real LLM output shape)', () => {
    const ai = 'Here are the tokens I inferred:\n```json\n{ "colors": { "primary": "#5b21b6" }, "typography": { "headingFont": "Poppins" } }\n```\nLet me know if you need more.';
    const brand = parseNormalizedBrand(ai, ev, 'https://acme.example.com/');
    expect(brand.colors.primary).toBe('#5b21b6');
    expect(brand.typography.headingFont).toBe('Poppins');
  });
});

describe('sourceFromExtraction', () => {
  const withContent = (engine: 'firecrawl' | 'heuristic'): ExtractedBrand => ({
    ...emptyExtractedBrand('https://x.test/', engine),
    colors: { primary: '#5b21b6' },
  });

  it('maps a content-bearing extraction: firecrawl → firecrawl-url, heuristic → reference-url', () => {
    expect(sourceFromExtraction(withContent('firecrawl'))).toBe('firecrawl-url');
    expect(sourceFromExtraction(withContent('heuristic'))).toBe('reference-url');
  });

  it('returns undefined for no extraction and for an empty (failed) extraction, so provenance stays manual', () => {
    expect(sourceFromExtraction(undefined)).toBeUndefined();
    expect(sourceFromExtraction(emptyExtractedBrand('https://x.test/', 'firecrawl'))).toBeUndefined();
  });
});

describe('mergeExtractedBrand', () => {
  const intake: DesignIntakeInput = {
    brandName: 'Acme',
    personality: ['modern'],
    colorPreferences: 'I like purple',
    existingBrandNotes: 'We rebranded last year',
  };
  const extracted: ExtractedBrand = {
    ...emptyExtractedBrand('https://acme.example.com/'),
    colors: { primary: '#5b21b6', accent: '#f59e0b' },
    typography: { headingFont: 'Poppins', bodyFont: 'Inter' },
    logoUrl: 'https://acme.example.com/logo.svg',
  };

  it('appends extracted evidence without discarding the user’s own answers', () => {
    const merged = mergeExtractedBrand(intake, extracted);
    expect(merged.colorPreferences).toContain('I like purple');
    expect(merged.colorPreferences).toContain('#5b21b6');
    expect(merged.existingBrandNotes).toContain('We rebranded last year');
    expect(merged.existingBrandNotes).toContain('Poppins');
    expect(merged.existingBrandNotes).toContain('https://acme.example.com/logo.svg');
    // Untouched fields pass through.
    expect(merged.brandName).toBe('Acme');
    expect(merged.personality).toEqual(['modern']);
  });

  it('works when the user provided no color/notes of their own', () => {
    const merged = mergeExtractedBrand({ brandName: 'Acme', personality: ['modern'] }, extracted);
    expect(merged.colorPreferences).toContain('#5b21b6');
    expect(merged.existingBrandNotes).toContain('Poppins');
  });
});

describe('extractedBrandToStyleGuidePatch', () => {
  const extracted: ExtractedBrand = {
    ...emptyExtractedBrand('https://acme.example.com/'),
    colors: { primary: '#5b21b6', accent: '#f59e0b', background: '#ffffff' },
    typography: { headingFont: 'Poppins', bodyFont: 'Inter' },
    radii: { md: '12px' },
    logoUrl: 'https://acme.example.com/logo.svg',
  };

  it('produces a patch of only whitelisted token fields and excludes the logo', () => {
    const patch = extractedBrandToStyleGuidePatch(extracted) as {
      colors?: Record<string, string>;
      typography?: Record<string, string>;
      radii?: Record<string, string>;
    };
    expect(patch.colors).toEqual({ primary: '#5b21b6', accent: '#f59e0b', background: '#ffffff' });
    expect(patch.typography).toEqual({ headingFont: 'Poppins', bodyFont: 'Inter' });
    expect(patch.radii).toEqual({ md: '12px' });
    expect('logoUrl' in patch).toBe(false);
  });

  it('the patch passes the real validateStyleGuideChange (the path the UI applies through)', () => {
    const guide = buildDefaultStyleGuide('acme', 'Acme', 'modern');
    const patch = extractedBrandToStyleGuidePatch(extracted);
    const result = validateStyleGuideChange(guide, patch);
    expect(result.ok).toBe(true);
    expect(result.applied!.colors.primary).toBe('#5b21b6');
    expect(result.applied!.typography.headingFont).toBe('Poppins');
    expect(result.applied!.radii.md).toBe('12px');
  });

  it('omits empty sections entirely', () => {
    const bare: ExtractedBrand = { ...emptyExtractedBrand('https://x.test/'), colors: { primary: '#5b21b6' } };
    const patch = extractedBrandToStyleGuidePatch(bare);
    expect(patch).toEqual({ colors: { primary: '#5b21b6' } });
  });
});
