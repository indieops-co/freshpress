import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  dedupeConsecutiveLines,
  parseNextJsPrompts,
  parseAdvancedRecipes,
} from '../seo-prompts/loader.js';

const PROMPTS_DIR = join(process.cwd(), 'ref', 'seo-prompts');

describe('SEO prompt loader', () => {
  it('dedupes consecutive duplicate lines', () => {
    expect(dedupeConsecutiveLines('a\na\nb\nb\nb\nc')).toBe('a\nb\nc');
  });

  it('parses Next.js HeadCheck prompts', async () => {
    const raw = await readFile(join(PROMPTS_DIR, 'headcheck-nextjs-seo.md'), 'utf-8');
    const prompts = parseNextJsPrompts(raw);
    expect(prompts.length).toBeGreaterThanOrEqual(10);
    expect(prompts[0].title).toContain('Project Foundation');
    expect(prompts.some((p) => p.title.includes('SEO Checker'))).toBe(true);
  });

  it('parses 17 advanced SEO recipes', async () => {
    const raw = await readFile(join(PROMPTS_DIR, 'advanced-seo-recipes.txt'), 'utf-8');
    const recipes = parseAdvancedRecipes(raw);
    expect(recipes).toHaveLength(17);
    expect(recipes[0].title).toContain('Recover a Stuck Page');
    expect(recipes[16].title).toContain('Cannibalization');
    expect(recipes[0].content).toContain('#SELF');
  });
});
