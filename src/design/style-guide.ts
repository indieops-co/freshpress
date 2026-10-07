import { z } from 'zod';

export const TypographyTokenSchema = z.object({
  size: z.string(),
  weight: z.string(),
  lineHeight: z.string(),
  tracking: z.string(),
  transform: z.string().optional(),
});

export const StyleGuideSchema = z.object({
  meta: z.object({
    id: z.string(),
    name: z.string(),
    source: z.enum(['awesome-design-md', 'firecrawl-url', 'reference-url', 'manual']),
    sourceRef: z.string(),
    aesthetic: z.string(),
    designPhilosophy: z.string(),
    createdAt: z.string(),
  }),
  colors: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    background: z.string(),
    surface: z.string(),
    surfaceStrong: z.string(),
    text: z.string(),
    textMuted: z.string(),
    textInverse: z.string(),
    border: z.string(),
    success: z.string(),
    warning: z.string(),
    error: z.string(),
    custom: z.record(z.string()).default({}),
  }),
  typography: z.object({
    headingFont: z.string(),
    bodyFont: z.string(),
    monoFont: z.string(),
    scale: z.object({
      displayLg: TypographyTokenSchema,
      displayMd: TypographyTokenSchema,
      h1: TypographyTokenSchema,
      h2: TypographyTokenSchema,
      h3: TypographyTokenSchema,
      h4: TypographyTokenSchema,
      bodyLg: TypographyTokenSchema,
      body: TypographyTokenSchema,
      bodySm: TypographyTokenSchema,
      caption: TypographyTokenSchema,
      label: TypographyTokenSchema,
    }),
  }),
  spacing: z.object({
    xs: z.string(),
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    xl: z.string(),
    section: z.string(),
    container: z.string(),
    gutter: z.string(),
  }),
  radii: z.object({
    none: z.string(),
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    xl: z.string(),
    pill: z.string(),
    full: z.string(),
  }),
  shadows: z.object({
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    glow: z.string(),
  }),
  components: z.object({
    button: z.object({
      primaryBg: z.string(),
      primaryText: z.string(),
      primaryRadius: z.string(),
      primaryPadding: z.string(),
      secondaryStyle: z.enum(['outline', 'ghost', 'soft']),
      ctaStyle: z.string(),
    }),
    card: z.object({
      background: z.string(),
      border: z.string(),
      radius: z.string(),
      shadow: z.string(),
      padding: z.string(),
    }),
    nav: z.object({
      style: z.enum(['floating', 'sticky', 'static', 'full-width']),
      background: z.string(),
      textColor: z.string(),
      ctaStyle: z.string(),
    }),
    hero: z.object({
      layout: z.enum(['centered', 'split-left', 'split-right', 'full-bleed']),
      headlineTreatment: z.string(),
      ctaCount: z.number(),
    }),
    footer: z.object({
      background: z.string(),
      style: z.enum(['minimal', 'full', 'dark-band']),
    }),
  }),
  motion: z.object({
    style: z.enum(['none', 'subtle', 'expressive']),
    defaultDuration: z.string(),
    defaultEasing: z.string(),
    pageLoad: z.string(),
  }),
  aiSystemPromptAddition: z.string(),
  /**
   * The source DESIGN.md's own guardrail prose (Do's and Don'ts etc.),
   * carried through parsing verbatim so it can reach generation prompts.
   * Derived deterministically by extractDesignRules (parse-design-md.ts) on
   * every theme apply/generate — never AI-authored, never user-editable via
   * PATCH (same prompt-injection posture as aiSystemPromptAddition). The
   * `.default('')` backfills legacy guides on their next store read.
   */
  designRules: z.string().default(''),
  tailwindExtension: z.record(z.unknown()).default({}),
  cssVariables: z.string(),
  /**
   * Site-wide raw CSS escape hatch (Site Theme page "Advanced: Custom CSS", Amendment A + Q2).
   * Unlike per-element NamedElement.customCss (one instance), this applies to the whole site.
   * Validated at write time by validateSiteCustomCss; appended after the token stylesheet.
   */
  customCss: z.string().default(''),
  /**
   * Brand logo pointer — a durable media-upload URL (e.g. from /media/upload), never
   * inline SVG markup: the consumers that need it (email header-logo) need an
   * <img src>, and inline markup would be an injection surface. Set via the design
   * import endpoint / owner panel only — not client-editable through Guardian PATCH,
   * same posture as customCss. Optional so guides that predate it re-parse unchanged.
   * `rasterUrl` is an optional PNG/JPEG rendition of the same logo: Gmail and Outlook
   * desktop don't render SVG in <img>, so email uses it and never the SVG `url`.
   */
  logo: z.object({ url: z.string(), alt: z.string().default(''), rasterUrl: z.string().optional() }).optional(),
});

export type StyleGuide = z.infer<typeof StyleGuideSchema>;

/** Named colors plus custom.* entries, flattened into one token-name -> value map. */
export function flattenColorTokens(guide: StyleGuide): Record<string, string> {
  const { custom, ...named } = guide.colors;
  const tokens: Record<string, string> = { ...named };
  for (const [key, value] of Object.entries(custom)) {
    tokens[`custom.${key}`] = value;
  }
  return tokens;
}

/**
 * Token-name -> value maps for each whitelisted per-element style property
 * (Chunk 3's ElementStyleChange) — the single source of truth for which
 * StyleGuide category backs each property, shared by Guardian validation and
 * the AI chat prompt.
 */
export function styleTokenMaps(guide: StyleGuide): {
  padding: Record<string, string>;
  margin: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  background: Record<string, string>;
  textColor: Record<string, string>;
} {
  const colors = flattenColorTokens(guide);
  return {
    padding: guide.spacing,
    margin: guide.spacing,
    radius: guide.radii,
    shadow: guide.shadows,
    background: colors,
    textColor: colors,
  };
}

const defaultToken = (size: string, weight = '400'): z.infer<typeof TypographyTokenSchema> => ({
  size,
  weight,
  lineHeight: '1.5',
  tracking: '0',
});

/**
 * Render-boundary hardening: token values flow in from AI generation and parsed DESIGN.md files
 * (less trusted than hand-written code) and are interpolated raw into a `<style>` block. The only
 * way to break out of `<style>` is a literal `<` (`</style>`), so escape every `<` to its CSS char
 * escape here — the single choke point that protects all sources (apply/generate/import/panel/chat)
 * at once. `>` is left intact so CSS child combinators (`.a > .b`) in site custom CSS still work.
 * `\3c ` renders as `<` where a value legitimately needs one (e.g. content:"<"), so nothing breaks.
 * Exported so generateElementOverrides (render.ts) — the other raw-into-<style> path — shares it.
 */
export function escapeStyleBreakout(css: string): string {
  return css.replace(/</g, '\\3c ');
}

export function generateCssVariables(guide: StyleGuide): string {
  const c = guide.colors;
  const custom = Object.entries(c.custom)
    .map(([key, value]) => `  --fp-custom-${key.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}: ${value};`)
    .join('\n');
  return escapeStyleBreakout(`:root {
  --fp-primary: ${c.primary};
  --fp-secondary: ${c.secondary};
  --fp-accent: ${c.accent};
  --fp-bg: ${c.background};
  --fp-surface: ${c.surface};
  --fp-surface-strong: ${c.surfaceStrong};
  --fp-text: ${c.text};
  --fp-text-muted: ${c.textMuted};
  --fp-text-inverse: ${c.textInverse};
  --fp-border: ${c.border};
  --fp-success: ${c.success};
  --fp-warning: ${c.warning};
  --fp-error: ${c.error};
  --fp-font-heading: ${guide.typography.headingFont}, system-ui, sans-serif;
  --fp-font-body: ${guide.typography.bodyFont}, system-ui, sans-serif;
  --fp-font-mono: ${guide.typography.monoFont};
  --fp-space-xs: ${guide.spacing.xs};
  --fp-space-sm: ${guide.spacing.sm};
  --fp-space-md: ${guide.spacing.md};
  --fp-space-lg: ${guide.spacing.lg};
  --fp-space-xl: ${guide.spacing.xl};
  --fp-space-section: ${guide.spacing.section};
  --fp-container: ${guide.spacing.container};
  --fp-gutter: ${guide.spacing.gutter};
  --fp-radius-sm: ${guide.radii.sm};
  --fp-radius-md: ${guide.radii.md};
  --fp-radius-lg: ${guide.radii.lg};
  --fp-radius-xl: ${guide.radii.xl};
  --fp-radius-pill: ${guide.radii.pill};
  --fp-shadow-sm: ${guide.shadows.sm};
  --fp-shadow-md: ${guide.shadows.md};
  --fp-shadow-lg: ${guide.shadows.lg};
  --fp-shadow-glow: ${guide.shadows.glow};
  --fp-duration: ${guide.motion.defaultDuration};
  --fp-easing: ${guide.motion.defaultEasing};${custom ? `\n${custom}` : ''}
}`);
}

type TypographyToken = z.infer<typeof TypographyTokenSchema>;

function typographyDecls(token: TypographyToken, fontVar: 'heading' | 'body' | 'mono'): string {
  const transform = token.transform ? `\n  text-transform: ${token.transform};` : '';
  return `  font-family: var(--fp-font-${fontVar});
  font-size: ${token.size};
  font-weight: ${token.weight};
  line-height: ${token.lineHeight};
  letter-spacing: ${token.tracking};${transform}`;
}

function secondaryButtonDecls(guide: StyleGuide): string {
  const btn = guide.components.button;
  switch (btn.secondaryStyle) {
    case 'ghost':
      return `  background: transparent;
  color: var(--fp-text);
  border: none;`;
    case 'soft':
      return `  background: var(--fp-surface-strong);
  color: var(--fp-text);
  border: none;`;
    case 'outline':
    default:
      return `  background: transparent;
  color: var(--fp-text);
  border: 1px solid var(--fp-border);`;
  }
}

/**
 * Full theme stylesheet: token variables plus semantic classes (.fp-h1,
 * .fp-btn-primary, .fp-card, …) plus tag-level rules scoped under .fp-page
 * so ingested/legacy templates pick up the theme without markup changes.
 * Generated pages (Chunk 8) use the semantic classes directly; both surfaces
 * share this one source.
 */
export function generateStyleSheet(guide: StyleGuide): string {
  const scale = guide.typography.scale;
  const btn = guide.components.button;
  const card = guide.components.card;
  const nav = guide.components.nav;
  const footer = guide.components.footer;
  const motion = guide.motion;

  const typeRules = (
    [
      ['display-lg', scale.displayLg, 'heading'],
      ['display-md', scale.displayMd, 'heading'],
      ['h1', scale.h1, 'heading'],
      ['h2', scale.h2, 'heading'],
      ['h3', scale.h3, 'heading'],
      ['h4', scale.h4, 'heading'],
      ['body-lg', scale.bodyLg, 'body'],
      ['body', scale.body, 'body'],
      ['body-sm', scale.bodySm, 'body'],
      ['caption', scale.caption, 'body'],
      ['label', scale.label, 'body'],
    ] as const
  )
    .map(([name, token, font]) => `.fp-${name} {\n${typographyDecls(token, font)}\n}`)
    .join('\n');

  const tagRules = `.fp-page h1 {\n${typographyDecls(scale.h1, 'heading')}\n}
.fp-page h2 {\n${typographyDecls(scale.h2, 'heading')}\n}
.fp-page h3 {\n${typographyDecls(scale.h3, 'heading')}\n}
.fp-page h4 {\n${typographyDecls(scale.h4, 'heading')}\n}
.fp-page p, .fp-page li {\n${typographyDecls(scale.body, 'body')}\n}
.fp-page small {\n${typographyDecls(scale.caption, 'body')}\n}
.fp-page a {
  color: var(--fp-primary);
}
.fp-page code, .fp-page pre {
  font-family: var(--fp-font-mono);
}
.fp-page img {
  max-width: 100%;
  height: auto;
}`;

  const motionRule =
    motion.style === 'none'
      ? ''
      : `\n.fp-page a, .fp-page button, .fp-btn-primary, .fp-btn-secondary {
  transition: all var(--fp-duration) var(--fp-easing);
}`;

  const navPosition =
    nav.style === 'sticky' || nav.style === 'floating'
      ? `\n  position: sticky;\n  top: ${nav.style === 'floating' ? 'var(--fp-space-md)' : '0'};\n  z-index: 50;`
      : '';

  return escapeStyleBreakout(`${generateCssVariables(guide)}

.fp-page {
  margin: 0;
  background: var(--fp-bg);
  color: var(--fp-text);
${typographyDecls(scale.body, 'body')}
}
${typeRules}
${tagRules}

.fp-page button, .fp-btn-primary {
  background: ${btn.primaryBg};
  color: ${btn.primaryText};
  border: none;
  border-radius: ${btn.primaryRadius};
  padding: ${btn.primaryPadding};
  font-family: var(--fp-font-body);
  font-weight: ${scale.label.weight};
  cursor: pointer;
}
.fp-btn-secondary {
${secondaryButtonDecls(guide)}
  border-radius: ${btn.primaryRadius};
  padding: ${btn.primaryPadding};
  font-family: var(--fp-font-body);
  font-weight: ${scale.label.weight};
  cursor: pointer;
}

.fp-card {
  background: ${card.background};
  border: ${card.border};
  border-radius: ${card.radius};
  box-shadow: ${card.shadow};
  padding: ${card.padding};
}

.fp-section {
  padding: var(--fp-space-section) var(--fp-gutter);
}
.fp-container {
  max-width: var(--fp-container);
  margin-inline: auto;
  padding-inline: var(--fp-gutter);
}

.fp-nav {
  background: ${nav.background};
  color: ${nav.textColor};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fp-space-md);
  padding: var(--fp-space-md) var(--fp-gutter);${navPosition}
}

.fp-hero {
  padding: var(--fp-space-section) var(--fp-gutter);
  display: flex;
  flex-direction: ${guide.components.hero.layout === 'centered' ? 'column' : 'row'};
  ${guide.components.hero.layout === 'centered' ? 'align-items: center;\n  text-align: center;' : 'align-items: center;'}
  gap: var(--fp-space-xl);
}

.fp-footer {
  background: ${footer.background};
  color: ${footer.style === 'dark-band' ? 'var(--fp-text-inverse)' : 'var(--fp-text)'};
  padding: var(--fp-space-xl) var(--fp-gutter);
}${motionRule}${guide.customCss?.trim() ? `\n\n/* site custom css */\n${guide.customCss.trim()}` : ''}`);
}

export function buildDefaultStyleGuide(themeId: string, themeName: string, aesthetic: string): StyleGuide {
  const id = `sg_${themeId}`;
  const guide: StyleGuide = {
    meta: {
      id,
      name: themeName,
      source: 'awesome-design-md',
      sourceRef: themeId,
      aesthetic,
      designPhilosophy: `${themeName} inspired design system with clean typography and balanced spacing.`,
      createdAt: new Date().toISOString(),
    },
    colors: {
      primary: '#000000',
      secondary: '#666666',
      accent: '#6c8cff',
      background: '#ffffff',
      surface: '#f5f5f5',
      surfaceStrong: '#ebebeb',
      text: '#111111',
      textMuted: '#666666',
      textInverse: '#ffffff',
      border: '#e5e5e5',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
      custom: {},
    },
    typography: {
      headingFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'ui-monospace, monospace',
      scale: {
        displayLg: defaultToken('3.5rem', '700'),
        displayMd: defaultToken('2.5rem', '700'),
        h1: defaultToken('2rem', '700'),
        h2: defaultToken('1.5rem', '600'),
        h3: defaultToken('1.25rem', '600'),
        h4: defaultToken('1.125rem', '600'),
        bodyLg: defaultToken('1.125rem'),
        body: defaultToken('1rem'),
        bodySm: defaultToken('0.875rem'),
        caption: defaultToken('0.75rem'),
        label: defaultToken('0.75rem', '600'),
      },
    },
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '16px',
      lg: '24px',
      xl: '32px',
      section: '80px',
      container: '1200px',
      gutter: '24px',
    },
    radii: {
      none: '0',
      sm: '4px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      pill: '999px',
      full: '9999px',
    },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 12px rgba(0,0,0,0.08)',
      lg: '0 12px 32px rgba(0,0,0,0.12)',
      glow: '0 0 24px rgba(108,140,255,0.35)',
    },
    components: {
      button: {
        primaryBg: '#000000',
        primaryText: '#ffffff',
        primaryRadius: '999px',
        primaryPadding: '12px 24px',
        secondaryStyle: 'outline',
        ctaStyle: 'Black pill button, full-width on mobile',
      },
      card: {
        background: '#ffffff',
        border: '1px solid #e5e5e5',
        radius: '12px',
        shadow: '0 4px 12px rgba(0,0,0,0.08)',
        padding: '24px',
      },
      nav: {
        style: 'sticky',
        background: '#ffffff',
        textColor: '#111111',
        ctaStyle: 'Primary CTA in nav, right-aligned',
      },
      hero: {
        layout: 'centered',
        headlineTreatment: 'Large display heading, tight tracking',
        ctaCount: 2,
      },
      footer: {
        background: '#111111',
        style: 'dark-band',
      },
    },
    motion: {
      style: 'subtle',
      defaultDuration: '200ms',
      defaultEasing: 'ease-out',
      pageLoad: 'staggered fade-up',
    },
    aiSystemPromptAddition: `Adopt the ${themeName} aesthetic: ${aesthetic}. Use Inter or system fonts unless specified. Prefer clean spacing and minimal decoration.`,
    designRules: '',
    tailwindExtension: {},
    cssVariables: '',
    customCss: '',
  };
  guide.cssVariables = generateCssVariables(guide);
  return StyleGuideSchema.parse(guide);
}
