import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { buildDefaultStyleGuide, type StyleGuide } from '../design/style-guide.js';

export interface TextCardOptions {
  headline: string;
  keyword?: string;
  variant: 'light' | 'dark';
  styleGuide?: StyleGuide | null;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

export function buildTextCardSvg(opts: TextCardOptions): string {
  const guide = opts.styleGuide ?? buildDefaultStyleGuide('default', 'Default', 'minimal');
  const isLight = opts.variant === 'light';
  const bg = isLight ? guide.colors.background : guide.colors.surfaceStrong;
  const textColor = isLight ? guide.colors.text : guide.colors.textInverse;
  const accent = guide.colors.accent;
  const headline = opts.headline.slice(0, 120);
  const lines = wrapText(headline, 22, 4);
  const tspans = lines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 48}">${escapeXml(line)}</tspan>`)
    .join('');

  const keywordLine = opts.keyword
    ? `<text x="80" y="920" font-family="${guide.typography.bodyFont}, sans-serif" font-size="28" fill="${accent}">${escapeXml(opts.keyword)}</text>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1080" fill="${bg}"/>
  <rect x="0" y="0" width="1080" height="8" fill="${accent}"/>
  <text x="80" y="420" font-family="${guide.typography.headingFont}, sans-serif" font-size="52" font-weight="700" fill="${textColor}">
    ${tspans}
  </text>
  ${keywordLine}
</svg>`;
}

export async function renderTextCardPng(
  opts: TextCardOptions,
  outputPath: string
): Promise<string> {
  const svg = buildTextCardSvg(opts);
  await mkdir(join(outputPath, '..'), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

export async function generateTextCardsForSite(
  siteId: string,
  publicDir: string,
  headline: string,
  keyword: string,
  styleGuide?: StyleGuide | null
): Promise<{ textCardLight: string; textCardDark: string }> {
  const dir = join(publicDir, 'social-images');
  await mkdir(dir, { recursive: true });
  const id = nanoid(8);
  const lightName = `${id}-light.png`;
  const darkName = `${id}-dark.png`;
  const lightPath = join(dir, lightName);
  const darkPath = join(dir, darkName);

  await renderTextCardPng({ headline, keyword, variant: 'light', styleGuide }, lightPath);
  await renderTextCardPng({ headline, keyword, variant: 'dark', styleGuide }, darkPath);

  return {
    textCardLight: `/media/${siteId}/social-images/${lightName}`,
    textCardDark: `/media/${siteId}/social-images/${darkName}`,
  };
}
