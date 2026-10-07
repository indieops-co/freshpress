/**
 * Token-value sanitizer for StyleGuide writes. The PATCH/chat paths already
 * reject dangerous CSS values (validate-style-guide.ts CSS_VALUE_FORBIDDEN),
 * but the theme-apply and AI-generate paths accept free-form strings straight
 * from a parsed DESIGN.md or an AI response — and generateStyleSheet /
 * generateCssVariables interpolate token values into a served <style> block
 * with only `<` escaped. A value like `url(https://evil/px)` would beacon
 * from every preview and published page.
 *
 * This sweeps exactly the string leaves those renderers interpolate and
 * BLANKS (never throws on) an offending value: a throw at the store choke
 * point would turn one bad AI token into a 500 that bricks a whole
 * theme-apply or wizard generation, while a blanked token degrades one CSS
 * declaration invisibly. Prose fields (meta, aiSystemPromptAddition,
 * designRules, ctaStyle, headlineTreatment, pageLoad) never reach CSS and are
 * left alone, as is customCss — where url() is legitimate and
 * validateSiteCustomCss is the authoritative gate.
 */
import type { StyleGuide } from '../design/style-guide.js';

/** Exported for the vendored-corpus regression test (awesome-design-md.test.ts). */
export const FORBIDDEN_CSS_TOKEN = /url\s*\(|@import\b|expression\s*\(/i;

export function sanitizeStyleGuideTokens(guide: StyleGuide): { guide: StyleGuide; warnings: string[] } {
  const clean: StyleGuide = JSON.parse(JSON.stringify(guide));
  const warnings: string[] = [];

  /** Blank forbidden values among `keys` (or every string field) of `obj`. Non-strings are skipped. */
  const sweep = (obj: Record<string, unknown>, path: string, keys?: string[]) => {
    for (const key of keys ?? Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'string' && FORBIDDEN_CSS_TOKEN.test(value)) {
        warnings.push(`${path}.${key} contained forbidden CSS (${value.slice(0, 80)}) — blanked`);
        obj[key] = '';
      }
    }
  };

  sweep(clean.colors as unknown as Record<string, unknown>, 'colors'); // `custom` is an object → skipped here
  sweep(clean.colors.custom, 'colors.custom');
  sweep(clean.typography as unknown as Record<string, unknown>, 'typography', ['headingFont', 'bodyFont', 'monoFont']);
  for (const [name, token] of Object.entries(clean.typography.scale)) {
    sweep(token as unknown as Record<string, unknown>, `typography.scale.${name}`);
  }
  sweep(clean.spacing as unknown as Record<string, unknown>, 'spacing');
  sweep(clean.radii as unknown as Record<string, unknown>, 'radii');
  sweep(clean.shadows as unknown as Record<string, unknown>, 'shadows');
  // Component enums (secondaryStyle, nav.style, footer.style, hero.*) and prose
  // (ctaStyle, headlineTreatment) are excluded by the explicit key lists.
  sweep(clean.components.button as unknown as Record<string, unknown>, 'components.button', [
    'primaryBg', 'primaryText', 'primaryRadius', 'primaryPadding',
  ]);
  sweep(clean.components.card as unknown as Record<string, unknown>, 'components.card');
  sweep(clean.components.nav as unknown as Record<string, unknown>, 'components.nav', ['background', 'textColor']);
  sweep(clean.components.footer as unknown as Record<string, unknown>, 'components.footer', ['background']);
  sweep(clean.motion as unknown as Record<string, unknown>, 'motion', ['defaultDuration', 'defaultEasing']);

  return { guide: warnings.length > 0 ? clean : guide, warnings };
}
