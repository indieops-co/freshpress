import type { BlogPost } from '../content/silo-types.js';

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

/** Auto-generate SEO fields on save (blog spec §10 subset). */
export function applyAutoSeo(post: BlogPost): BlogPost {
  const plain = stripHtml(post.bodyHtml);
  const metaTitle = truncate(post.metaTitle ?? `${post.title} | ${post.keyword}`, 58);
  const intro = plain.slice(0, 200);
  const metaDescription = truncate(
    post.metaDescription ?? (intro || `Learn about ${post.keyword}.`),
    155
  );

  return {
    ...post,
    metaTitle,
    metaDescription,
    slug: post.slug || post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  };
}
