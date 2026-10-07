/**
 * Validates the raw-CSS escape hatch (NamedElement.customCss / ElementCustomCssChange,
 * Amendment A). Declaration list only — no selectors, braces, at-rules, or urls. Dependency-free
 * regex validation; this is authoritative server-side, mirrored client-side for instant feedback.
 */

const FORBIDDEN_PATTERN = /[{}@]|<\/|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript:/i;
const DECLARATION_PATTERN = /^[a-zA-Z-]+\s*:\s*[^;]+;$/;

export function validateCustomCss(css: string): string[] {
  const errors: string[] = [];
  const trimmed = css.trim();

  if (!trimmed) {
    errors.push('Custom CSS cannot be empty');
    return errors;
  }

  if (FORBIDDEN_PATTERN.test(trimmed)) {
    errors.push(
      'Custom CSS contains disallowed syntax — selectors, braces, @rules, url(), and script triggers are not permitted; declaration list only'
    );
    return errors;
  }

  const declarations = trimmed
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);

  if (declarations.length === 0) {
    errors.push('Custom CSS must contain at least one property: value declaration');
    return errors;
  }

  for (const decl of declarations) {
    if (!DECLARATION_PATTERN.test(`${decl};`)) {
      errors.push(`Invalid CSS declaration: "${decl}"`);
    }
  }

  return errors;
}
