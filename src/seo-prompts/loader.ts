import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeoPrompt, SeoPromptCollection } from './types.js';

const PROMPTS_DIR = join(process.cwd(), 'ref', 'seo-prompts');

const NEXTJS_FILE = 'headcheck-nextjs-seo.md';
const RECIPES_FILE = 'advanced-seo-recipes.txt';

const RECIPE_TITLES = [
  'Recover a Stuck Page in ONE Command',
  'Site Wide Internal Links',
  'Single Page Internal Links, Detailed Version',
  'Single Page Internal Links, Simple Version',
  'Site Wide Refresh for Old or Stale Pages',
  'Light Page Refresh, Single Page',
  'Standard Optimization, Single Page',
  'Standard Optimization, Site Wide',
  'Full Client Website Audit PDF',
  'Single Page Audit PDF',
  'Advanced Page Diagnostic: Why Is This Page Not Ranking?',
  'Sub Headline Optimization, Single Page',
  'Image and Alt Text Optimization, Single Page',
  'Local Page Diagnostic: Why Is This Local Page Not Ranking?',
  'Local Page Tuning, Standard Optimization',
  'Local Website and GBP Alignment Verification',
  'Local Website Cannibalization Checker, City or Region Audit',
];

/** Remove consecutive duplicate lines present in the Headcheck source export */
export function dedupeConsecutiveLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (out.length === 0 || out[out.length - 1] !== line) {
      out.push(line);
    }
  }
  return out.join('\n').trim();
}

export function parseNextJsPrompts(raw: string): SeoPrompt[] {
  const text = dedupeConsecutiveLines(raw);
  const parts = text.split(/^## Prompt (\d+) — (.+)$/m);
  const prompts: SeoPrompt[] = [];

  for (let i = 1; i < parts.length; i += 3) {
    const number = parseInt(parts[i], 10);
    const title = parts[i + 1].trim();
    const body = (parts[i + 2] ?? '').trim();
    if (!body) continue;

    prompts.push({
      id: `nextjs-prompt-${number}`,
      category: 'nextjs',
      number,
      title,
      description: extractFirstParagraph(body),
      content: body,
      source: 'headcheck',
    });
  }

  return prompts;
}

export function parseAdvancedRecipes(raw: string): SeoPrompt[] {
  const text = dedupeConsecutiveLines(raw);
  const prompts: SeoPrompt[] = [];

  for (let n = 0; n < RECIPE_TITLES.length; n++) {
    const number = n + 1;
    const title = RECIPE_TITLES[n];
    const header = `${number}. ${title}`;
    const start = findRecipeSectionStart(text, header);
    if (start < 0) continue;

    const nextNumber = number + 1;
    const nextHeader =
      nextNumber <= RECIPE_TITLES.length
        ? `${nextNumber}. ${RECIPE_TITLES[n + 1]}`
        : null;

    const end = nextHeader ? findRecipeSectionStart(text, nextHeader, start + header.length) : text.length;
    const slice = text.slice(start, end > start ? end : undefined).trim();
    const content = slice.startsWith(header) ? slice.slice(header.length).trim() : slice;

    prompts.push({
      id: `recipe-${number}`,
      category: 'advanced-recipe',
      number,
      title,
      description: extractFirstParagraph(content),
      content,
      source: 'headcheck',
    });
  }

  return prompts;
}

/** Pick the section header instance that precedes actual recipe prompt content */
function findRecipeSectionStart(text: string, header: string, from = 0): number {
  let pos = from;
  while (pos < text.length) {
    const idx = text.indexOf(header, pos);
    if (idx === -1) return -1;
    const after = text.slice(idx + header.length, idx + header.length + 800);
    if (after.includes('#SELF') || after.includes('#TASK')) {
      return idx;
    }
    pos = idx + header.length;
  }
  return -1;
}

function extractFirstParagraph(body: string): string {
  const cleaned = body.replace(/^```[\s\S]*?```/m, '').trim();
  const line = cleaned.split('\n').find((l) => l.trim().length > 20 && !l.startsWith('#'));
  return line?.trim().slice(0, 160) ?? '';
}

let cache: SeoPromptCollection[] | null = null;

export async function loadSeoPromptCollections(): Promise<SeoPromptCollection[]> {
  if (cache) return cache;

  const [nextjsRaw, recipesRaw] = await Promise.all([
    readFile(join(PROMPTS_DIR, NEXTJS_FILE), 'utf-8'),
    readFile(join(PROMPTS_DIR, RECIPES_FILE), 'utf-8'),
  ]);

  const nextjsPrompts = parseNextJsPrompts(nextjsRaw);
  const recipePrompts = parseAdvancedRecipes(recipesRaw);

  cache = [
    {
      id: 'nextjs',
      title: 'HeadCheck — Next.js SEO Build Prompts',
      description:
        'Step-by-step Cursor/Claude Code prompts for building and auditing Next.js SEO (from Headcheck).',
      sourceUrl: 'https://github.com/davidsparrow/Headcheck',
      prompts: nextjsPrompts,
    },
    {
      id: 'advanced-recipe',
      title: 'Advanced SEO Automation Recipes',
      description:
        '17 copy/paste agent recipes for on-page SEO work using real-time SEO intelligence.',
      sourceUrl: 'https://github.com/davidsparrow/Headcheck/tree/main/ai_ref',
      prompts: recipePrompts,
    },
  ];

  return cache;
}

export async function getSeoPrompt(id: string): Promise<SeoPrompt | null> {
  const collections = await loadSeoPromptCollections();
  for (const col of collections) {
    const found = col.prompts.find((p) => p.id === id);
    if (found) return found;
  }
  return null;
}

export function applySiteContext(content: string, context?: { siteUrl?: string; pageUrl?: string }): string {
  if (!context) return content;
  let result = content;
  if (context.siteUrl) {
    result = result.replace(/https:\/\/(?:www\.)?yoursite\.com/gi, context.siteUrl.replace(/\/$/, ''));
    result = result.replace(/https:\/\/yoursite\.com/gi, context.siteUrl.replace(/\/$/, ''));
  }
  if (context.pageUrl) {
    result = result.replace(/https:\/\/www\.yoursite\.com\/url\/?/gi, context.pageUrl);
    result = result.replace(/https:\/\/yoursite\.com\/yourtargetURL\/?/gi, context.pageUrl);
  }
  return result;
}

/** Test helper */
export function clearSeoPromptCache(): void {
  cache = null;
}
