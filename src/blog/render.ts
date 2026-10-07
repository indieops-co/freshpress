import type { BlogPost, BlogPillar } from '../content/silo-types.js';
import type { StyleGuide } from '../design/style-guide.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readingTimeMinutes(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function articleJsonLd(post: BlogPost, siteUrl: string): string {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.metaDescription ?? '',
    datePublished: post.publishedAt ?? post.createdAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: `${siteUrl}/blog/${post.slug}`,
  };
  return JSON.stringify(schema);
}

function baseStyles(guide?: StyleGuide | null): string {
  const vars =
    guide?.cssVariables ??
    `:root { --fp-bg: #fff; --fp-text: #111; --fp-text-muted: #666; --fp-accent: #6c8cff; --fp-font-body: Inter, system-ui, sans-serif; --fp-font-heading: Inter, system-ui, sans-serif; }`;
  // Site-wide custom CSS (validated) applies to the blog silo too, matching the main page render.
  const custom = guide?.customCss?.trim() ? `\n${guide.customCss.trim()}` : '';
  return vars + custom;
}

function layoutShell(title: string, body: string, guide?: StyleGuide | null, extraHead = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${baseStyles(guide)}
    body { margin: 0; font-family: var(--fp-font-body); background: var(--fp-bg); color: var(--fp-text); line-height: 1.6; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1, h2, h3 { font-family: var(--fp-font-heading); line-height: 1.2; }
    a { color: var(--fp-accent); }
    .meta { color: var(--fp-text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
    .card { border: 1px solid #e5e5e5; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
    .card h2 { margin: 0 0 0.35rem; font-size: 1.25rem; }
    .card p { margin: 0; color: var(--fp-text-muted); font-size: 0.95rem; }
  </style>
  ${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}

export function renderBlogPostHtml(
  post: BlogPost,
  options: {
    siteUrl: string;
    guide?: StyleGuide | null;
    relatedPosts?: BlogPost[];
    pillar?: BlogPillar | null;
  }
): string {
  const mins = readingTimeMinutes(post.bodyHtml);
  const canonical = post.canonicalUrl ?? `${options.siteUrl}/blog/${post.slug}`;
  const metaTitle = post.metaTitle ?? post.title;
  const metaDesc = post.metaDescription ?? '';

  const related =
    options.relatedPosts && options.relatedPosts.length > 0
      ? `<section><h2>Related in this topic</h2><ul>${options.relatedPosts
          .filter((p) => p.id !== post.id && p.status === 'published')
          .map(
            (p) =>
              `<li><a href="/blog/${escapeHtml(p.slug)}.html">${escapeHtml(p.title)}</a></li>`
          )
          .join('')}</ul></section>`
      : '';

  const pillarLink =
    post.kind === 'supportive' && options.pillar
      ? `<p><a href="/blog/${escapeHtml(options.pillar.slug)}.html">← ${escapeHtml(options.pillar.title)}</a></p>`
      : '';

  const body = `<article class="wrap">
  ${pillarLink}
  <h1>${escapeHtml(post.title)}</h1>
  <p class="meta">${mins} min read · ${escapeHtml(post.keyword)}</p>
  ${post.bodyHtml}
  ${related}
</article>`;

  const head = `
  <meta name="description" content="${escapeHtml(metaDesc)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <script type="application/ld+json">${articleJsonLd(post, options.siteUrl)}</script>`;

  return layoutShell(metaTitle, body, options.guide, head);
}

export function renderBlogIndexHtml(
  silos: Array<{ pillar: BlogPillar; posts: BlogPost[] }>,
  options: { siteUrl: string; guide?: StyleGuide | null }
): string {
  const sections = silos
    .map(({ pillar, posts }) => {
      const published = posts.filter((p) => p.status === 'published');
      const pillarPost = published.find((p) => p.kind === 'pillar');
      const supportives = published.filter((p) => p.kind === 'supportive');
      const featured = pillarPost ?? published[0];
      if (!featured) return '';

      return `<section class="wrap" style="padding-top:2rem">
        <h2>${escapeHtml(pillar.title)}</h2>
        <p class="meta">${escapeHtml(pillar.keyword)}</p>
        <div class="card">
          <h2><a href="/blog/${escapeHtml(featured.slug)}.html">${escapeHtml(featured.title)}</a></h2>
          <p>${escapeHtml(featured.metaDescription ?? '')}</p>
        </div>
        ${supportives
          .map(
            (p) =>
              `<div class="card"><h2><a href="/blog/${escapeHtml(p.slug)}.html">${escapeHtml(p.title)}</a></h2></div>`
          )
          .join('')}
      </section>`;
    })
    .join('');

  const body = `<header class="wrap" style="padding-top:3rem">
  <h1>Blog</h1>
  <p class="meta">Editorial stack index</p>
</header>
${sections}`;

  return layoutShell('Blog', body, options.guide);
}

export function renderBlogBundle(
  silos: Array<{ pillar: BlogPillar; posts: BlogPost[] }>,
  options: { siteUrl: string; guide?: StyleGuide | null }
): Record<string, string> {
  const files: Record<string, string> = {};
  files['blog/index.html'] = renderBlogIndexHtml(silos, options);

  for (const { pillar, posts } of silos) {
    const published = posts.filter((p) => p.status === 'published');
    for (const post of published) {
      files[`blog/${post.slug}.html`] = renderBlogPostHtml(post, {
        siteUrl: options.siteUrl,
        guide: options.guide,
        pillar,
        relatedPosts: published,
      });
    }
  }

  return files;
}
