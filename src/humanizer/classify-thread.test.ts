import { describe, it, expect } from 'vitest';
import { parseCategoryResponse } from './classify-thread.js';

describe('parseCategoryResponse', () => {
  it('parses a clean single-word answer', () => {
    expect(parseCategoryResponse('personal')).toBe('personal');
    expect(parseCategoryResponse('promo')).toBe('promo');
    expect(parseCategoryResponse('newsletter')).toBe('newsletter');
  });

  it('tolerates surrounding whitespace, punctuation, and case', () => {
    expect(parseCategoryResponse('  Personal.\n')).toBe('personal');
    expect(parseCategoryResponse('PROMO!')).toBe('promo');
  });

  it('returns undefined for an unrecognized answer', () => {
    expect(parseCategoryResponse('not sure')).toBeUndefined();
    expect(parseCategoryResponse('')).toBeUndefined();
  });
});
