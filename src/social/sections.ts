import * as cheerio from 'cheerio';
import type { BlogPost } from '../content/silo-types.js';
import type { SocialGenerationMeta } from '../content/social-types.js';

export interface BlogSection {
  slug: string;
  heading: string;
  excerpt: string;
}

export function extractBlogSections(bodyHtml: string): BlogSection[] {
  const $ = cheerio.load(bodyHtml);
  const sections: BlogSection[] = [];

  $('h2, h3').each((_, el) => {
    const heading = $(el).text().trim();
    if (!heading) return;

    const slug = heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const parts: string[] = [];
    let sibling = $(el).next();
    while (sibling.length && !/^h[23]$/i.test(sibling.prop('tagName') ?? '')) {
      if (sibling.is('p')) {
        const text = sibling.text().trim();
        if (text) parts.push(text);
      }
      sibling = sibling.next();
    }

    sections.push({
      slug: slug || `section-${sections.length + 1}`,
      heading,
      excerpt: parts.join(' ').slice(0, 400),
    });
  });

  if (sections.length === 0) {
    const intro = $('p')
      .first()
      .text()
      .trim()
      .slice(0, 400);
    sections.push({
      slug: 'intro',
      heading: 'Introduction',
      excerpt: intro || 'Main content',
    });
  }

  return sections;
}

export function pickNextSection(
  sections: BlogSection[],
  meta: SocialGenerationMeta | undefined
): { section: BlogSection; overlap: boolean; overlapRun?: number } {
  const used = meta?.usedSections ?? [];

  const unused = sections.find((s) => !used.includes(s.slug));
  if (unused) return { section: unused, overlap: false };

  const idx = (meta?.runCount ?? 0) % sections.length;
  const section = sections[idx] ?? sections[0];
  const firstUsedIdx = used.indexOf(section.slug);
  return {
    section,
    overlap: true,
    overlapRun: firstUsedIdx >= 0 ? firstUsedIdx + 1 : undefined,
  };
}

export function extractHeroImageUrl(bodyHtml: string): string | null {
  const $ = cheerio.load(bodyHtml);
  const src = $('img').first().attr('src');
  return src?.trim() || null;
}

export function buildGenerationMetaUpdate(
  post: BlogPost,
  sectionSlug: string
): BlogPost['socialGenerationMeta'] {
  const prev = post.socialGenerationMeta ?? { runCount: 0, usedSections: [] };
  return {
    runCount: prev.runCount + 1,
    usedSections: prev.usedSections.includes(sectionSlug)
      ? prev.usedSections
      : [...prev.usedSections, sectionSlug],
  };
}
