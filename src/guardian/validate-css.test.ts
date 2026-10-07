import { describe, expect, it } from 'vitest';
import { validateCustomCss } from './validate-css.js';

describe('validateCustomCss', () => {
  it('accepts a simple declaration', () => {
    expect(validateCustomCss('letter-spacing: 0.04em;')).toEqual([]);
  });

  it('accepts multiple declarations', () => {
    expect(validateCustomCss('letter-spacing: 0.04em; text-transform: uppercase;')).toEqual([]);
  });

  it('accepts !important', () => {
    expect(validateCustomCss('color: red !important;')).toEqual([]);
  });

  it('tolerates a missing trailing semicolon on the last declaration', () => {
    expect(validateCustomCss('color: red')).toEqual([]);
  });

  it('rejects empty input', () => {
    expect(validateCustomCss('   ')).not.toEqual([]);
  });

  it('rejects braces (selector injection)', () => {
    expect(validateCustomCss('.evil { color: red; }')).not.toEqual([]);
  });

  it('rejects @rules', () => {
    expect(validateCustomCss('@import "evil.css";')).not.toEqual([]);
  });

  it('rejects url()', () => {
    expect(validateCustomCss('background: url(javascript:alert(1));')).not.toEqual([]);
  });

  it('rejects javascript: triggers', () => {
    expect(validateCustomCss('background-image: javascript:alert(1);')).not.toEqual([]);
  });

  it('rejects expression()', () => {
    expect(validateCustomCss('width: expression(alert(1));')).not.toEqual([]);
  });

  it('rejects a malformed declaration', () => {
    expect(validateCustomCss('this is not css')).not.toEqual([]);
  });
});
