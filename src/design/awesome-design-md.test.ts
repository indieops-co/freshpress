import { describe, expect, it } from 'vitest';
import { fetchDesignMd, listThemes, parseAwesomeDesignMdRef, themeNameFromDirId } from './awesome-design-md.js';
import { extractDesignRules } from './parse-design-md.js';
import { FORBIDDEN_CSS_TOKEN } from '../guardian/sanitize-style-guide.js';

describe('parseAwesomeDesignMdRef', () => {
  it('parses github.com blob URLs to a DESIGN.md', () => {
    expect(
      parseAwesomeDesignMdRef(
        'https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/stripe/DESIGN.md'
      )
    ).toBe('stripe');
  });

  it('parses github.com tree URLs to a theme directory', () => {
    expect(
      parseAwesomeDesignMdRef('https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/linear.app')
    ).toBe('linear.app');
  });

  it('parses raw.githubusercontent.com URLs', () => {
    expect(
      parseAwesomeDesignMdRef(
        'https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/apple/DESIGN.md'
      )
    ).toBe('apple');
  });

  it('accepts bare directory ids', () => {
    expect(parseAwesomeDesignMdRef('stripe')).toBe('stripe');
    expect(parseAwesomeDesignMdRef('  Mistral.AI  ')).toBe('mistral.ai');
    expect(parseAwesomeDesignMdRef('bmw-m')).toBe('bmw-m');
  });

  it('rejects other repos and hosts', () => {
    expect(
      parseAwesomeDesignMdRef('https://github.com/someone-else/awesome-design-md/blob/main/design-md/stripe/DESIGN.md')
    ).toBeNull();
    expect(
      parseAwesomeDesignMdRef('https://github.com/VoltAgent/other-repo/blob/main/design-md/stripe/DESIGN.md')
    ).toBeNull();
    expect(parseAwesomeDesignMdRef('https://evil.example.com/design-md/stripe/DESIGN.md')).toBeNull();
  });

  it('rejects paths outside design-md or with trailing junk', () => {
    expect(
      parseAwesomeDesignMdRef('https://github.com/VoltAgent/awesome-design-md/blob/main/README.md')
    ).toBeNull();
    expect(
      parseAwesomeDesignMdRef(
        'https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/stripe/assets/logo.svg'
      )
    ).toBeNull();
  });

  it('rejects empty and malformed input', () => {
    expect(parseAwesomeDesignMdRef('')).toBeNull();
    expect(parseAwesomeDesignMdRef('   ')).toBeNull();
    expect(parseAwesomeDesignMdRef('not a url with spaces')).toBeNull();
  });
});

describe('themeNameFromDirId', () => {
  it('title-cases and strips common TLD suffixes', () => {
    expect(themeNameFromDirId('stripe')).toBe('Stripe');
    expect(themeNameFromDirId('linear.app')).toBe('Linear');
    expect(themeNameFromDirId('mistral.ai')).toBe('Mistral');
    expect(themeNameFromDirId('bmw-m')).toBe('Bmw M');
  });
});

describe('themes manifest ↔ vendored corpus', () => {
  it('every manifest theme has a vendored DESIGN.md that the parser can harvest', async () => {
    for (const theme of listThemes()) {
      const raw = await fetchDesignMd(theme.id);
      expect(raw.length, `${theme.id} vendored file`).toBeGreaterThan(1000);
      const rules = extractDesignRules(raw);
      expect(rules.length, `${theme.id} designRules`).toBeGreaterThan(100);
    }
  });

  it('no vendored theme carries url()/@import/expression() in a token-value line (sanitizer never mutates the corpus)', async () => {
    // The store-level sanitizer (sanitize-style-guide.ts) blanks these vectors
    // at save time. Token values in the corpus come from key/value lines —
    // assert the vectors never appear on one, so applying any vendored theme
    // is guaranteed lossless through the sanitizer. Prose paragraphs (which
    // may legitimately SAY "url(...)") don't match the key/value shape.
    for (const theme of listThemes()) {
      const raw = await fetchDesignMd(theme.id);
      for (const line of raw.split('\n')) {
        if (!/^[\s|>-]*[`"'*\w-]+[`"']?\s*[:=]\s*\S/.test(line)) continue;
        expect(
          FORBIDDEN_CSS_TOKEN.test(line),
          `${theme.id}: token-value line carries a forbidden CSS vector: ${line.trim().slice(0, 100)}`
        ).toBe(false);
      }
    }
  });
});
