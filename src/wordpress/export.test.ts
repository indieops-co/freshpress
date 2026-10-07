import { describe, it, expect } from 'vitest';
import {
  slugify,
  templateToPhp,
  buildWordPressTheme,
  buildThemeNotesMd,
  pageSlug,
} from '../wordpress/export.js';
import { buildDefaultStyleGuide, generateStyleSheet } from '../design/style-guide.js';
import { extractFontSubstitutesNote } from '../design/parse-design-md.js';
import type { Site } from '../storage/types.js';

const site: Site = {
  meta: {
    id: 'abc123',
    name: 'Acme Corp',
    domain: 'acme.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  pages: [
    {
      id: 'p1',
      path: '/',
      title: 'Home',
      content: {
        template: '<h1>{{slot:h1}}</h1><p>{{slot:p1}}</p>',
        slots: {
          h1: { id: 'h1', type: 'text', value: 'Welcome', tag: 'h1', path: 'h1[0]' },
          p1: { id: 'p1', type: 'text', value: 'Hello world', tag: 'p', path: 'p[0]' },
        },
        slotOrder: ['h1', 'p1'],
      },
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'p2',
      path: '/about',
      title: 'About',
      content: {
        template: '<p>{{slot:a1}}</p>',
        slots: {
          a1: { id: 'a1', type: 'text', value: 'About us', tag: 'p', path: 'p[0]' },
        },
        slotOrder: ['a1'],
      },
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
};

describe('WordPress export', () => {
  it('slugifies theme names', () => {
    expect(slugify('Acme Corp!')).toBe('acme-corp');
  });

  it('converts slot placeholders to PHP', () => {
    const php = templateToPhp('<h1>{{slot:text-h1-0}}</h1>');
    expect(php).toContain("freshpress_slot('text-h1-0')");
    expect(php).not.toContain('{{slot:');
  });

  it('builds a complete theme file set', () => {
    const theme = buildWordPressTheme(site);
    expect(theme.themeSlug).toBe('freshpress-acme-corp');
    expect(theme.files['style.css']).toContain('Theme Name: Acme Corp');
    expect(theme.files['functions.php']).toContain('freshpress_activate_theme');
    expect(theme.files['inc/slots.json']).toContain('"h1"');
    expect(theme.files['front-page.php']).toContain('freshpress_slot');
    expect(theme.files['page-about.php']).toBeDefined();
    expect(theme.files['INSTALL.md']).toContain('Settings → Reading');
    expect(theme.files['ANIMATIONS.md']).toContain('Framer Motion');
    expect(pageSlug(site.pages[1])).toBe('about');
  });
});

describe('WordPress export with a StyleGuide', () => {
  const guide = buildDefaultStyleGuide('vercel', 'Vercel', 'monochrome precision');
  guide.designRules = "### Don't\n- Never add a sixth accent color";

  it('bundles the guide stylesheet into assets/theme.css alongside inline styles', () => {
    const theme = buildWordPressTheme(site, { styleGuide: guide });
    const css = theme.files['assets/theme.css'];
    expect(css).toContain('--fp-primary');
    expect(css).toContain('.fp-btn-primary');
    expect(theme.files['functions.php']).toContain('assets/theme.css');
  });

  it('tags exported page markup with fp-page so tag-level theme rules apply', () => {
    const themed = buildWordPressTheme(site, { styleGuide: guide });
    expect(themed.files['front-page.php']).toContain('freshpress-page fp-page');
    const bare = buildWordPressTheme(site);
    expect(bare.files['front-page.php']).not.toContain('fp-page');
  });

  it('orders theme css after inline page styles, mirroring the in-app cascade', () => {
    const withInline: Site = {
      ...site,
      pages: [
        {
          ...site.pages[0],
          content: {
            ...site.pages[0].content,
            template: '<style>.fp-hero { background: #fff; }</style>' + site.pages[0].content.template,
          },
        },
      ],
    };
    const theme = buildWordPressTheme(withInline, { styleGuide: guide });
    const css = theme.files['assets/theme.css'];
    expect(css.indexOf('Exported inline page styles')).toBeLessThan(
      css.indexOf('FreshPress StyleGuide theme')
    );
  });

  it('exports per-element override CSS with data-element-id selectors', () => {
    const withOverrides: Site = {
      ...site,
      pages: [
        {
          ...site.pages[0],
          content: {
            ...site.pages[0].content,
            namedElements: {
              el1: {
                id: 'el1',
                type: 'InfoCard',
                index: 1,
                pageNumber: 1,
                containerId: 'c1',
                customCss: 'border: 2px solid red;',
                source: 'heuristic',
              },
            },
          },
        },
      ],
    };
    const theme = buildWordPressTheme(withOverrides, { styleGuide: guide });
    expect(theme.files['assets/theme.css']).toContain('[data-element-id="el1"]');
  });

  it('documents only classes that generateStyleSheet actually emits (drift guard)', () => {
    const notes = buildThemeNotesMd(guide);
    const stylesheet = generateStyleSheet(guide);
    const documented = [...new Set(notes.match(/\.fp-[a-z0-9-]+/g) ?? [])];
    expect(documented.length).toBeGreaterThan(8);
    for (const cls of documented) {
      expect(stylesheet).toContain(cls);
    }
  });

  it('keeps THEME-NOTES structure safe from multi-line meta fields', () => {
    const sneaky = buildDefaultStyleGuide('x', 'Evil\n## Injected', 'aes\nthetic');
    const notes = buildThemeNotesMd(sneaky);
    expect(notes).toContain('# Theme Notes — Evil ## Injected');
    expect(notes).not.toContain('\n## Injected');
  });

  it('exports THEME-NOTES.md with designRules, class table, and font stack', () => {
    const theme = buildWordPressTheme(site, { styleGuide: guide });
    const notes = theme.files['THEME-NOTES.md'];
    expect(notes).toContain('Never add a sixth accent color');
    expect(notes).toContain('.fp-card');
    expect(notes).toContain(`Headings: ${guide.typography.headingFont}`);
    expect(theme.files['README.md']).toContain('THEME-NOTES.md');
  });

  it('quotes the source font-substitutes note verbatim when provided', () => {
    const notes = buildThemeNotesMd(guide, 'The two primary faces are proprietary. Substitute **Inter**.');
    expect(notes).toContain('Substitute **Inter**.');
    expect(notes).not.toContain('did not document font substitutions');
  });

  it('falls back to a verify-licensing note when no substitutes are documented', () => {
    const notes = buildThemeNotesMd(guide);
    expect(notes).toContain('Verify each font');
  });

  it('still exports without a guide: no fp theme css, no THEME-NOTES.md, no crash', () => {
    const theme = buildWordPressTheme(site);
    expect(theme.files['assets/theme.css']).not.toContain('--fp-primary');
    expect(theme.files['THEME-NOTES.md']).toBeUndefined();
    expect(theme.files['README.md']).not.toContain('THEME-NOTES.md');
  });
});

describe('extractFontSubstitutesNote', () => {
  it('extracts the ### section body up to the next heading (real corpus shape)', () => {
    const md = `## Typography

- **Weight 600 is the display ceiling.** The sans never appears at 700.

### Note on Font Substitutes
The two primary faces are proprietary (custom-cut for the brand). Open-source substitutes:
- **Geometric sans** — *Inter* (400 / 500 / 600) is the closest stylistic match.
- **Monospace** — *JetBrains Mono* (400) matches the technical voice.

## Layout

### Spacing System
- **Base unit**: 4 px.
`;
    const note = extractFontSubstitutesNote(md);
    expect(note).toContain('proprietary (custom-cut for the brand)');
    expect(note).toContain('JetBrains Mono');
    expect(note).not.toContain('Spacing System');
    expect(note).not.toContain('## Layout');
  });

  it('returns empty string when the section is absent', () => {
    expect(extractFontSubstitutesNote('## Typography\n- Inter everywhere.')).toBe('');
  });
});
