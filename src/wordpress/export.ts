import * as cheerio from 'cheerio';
import type { Site, SitePage } from '../storage/types.js';
import { generateStyleSheet, type StyleGuide } from '../design/style-guide.js';
import { generateElementOverrides } from '../content/render.js';
import { injectElementIds } from '../content/containers.js';
import { productUrl, watermarkHtml } from '../publish/watermark.js';

export interface WordPressThemeExport {
  themeSlug: string;
  themeName: string;
  files: Record<string, string>;
}

export interface WordPressExportOptions {
  /** The site's active StyleGuide — bundles its stylesheet + THEME-NOTES.md. */
  styleGuide?: StyleGuide | null;
  /**
   * The source DESIGN.md's "Note on Font Substitutes" body (see
   * extractFontSubstitutesNote) — licensed-face → public-substitute mapping
   * quoted verbatim in THEME-NOTES.md. Absent → a generic verify-licensing note.
   */
  fontSubstitutesNote?: string;
  /** Tier watermark: inject the FreshPress footer link into footer.php. */
  watermark?: boolean;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'freshpress-site';
}

export function pageSlug(page: SitePage): string {
  if (page.path === '/') return 'home';
  return slugify(page.path.replace(/^\//, '').replace(/\//g, '-'));
}

/** Convert FreshPress slot placeholders to PHP helper calls */
export function templateToPhp(template: string): string {
  const regex = /\{\{slot:([^}]+)\}\}/g;
  return template.replace(regex, (_match, id: string) => {
    const safeId = id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<?php freshpress_slot('${safeId}'); ?>`;
  });
}

export interface ExtractedAssets {
  styles: string[];
  scripts: string[];
  animationHints: string[];
}

/** Pull inline styles/scripts and detect animation libraries from HTML */
export function extractAssetsFromHtml(html: string): ExtractedAssets {
  const styles: string[] = [];
  const scripts: string[] = [];
  const animationHints = new Set<string>();

  const $ = cheerio.load(html, { xml: false });
  $('style').each((_, el) => {
    const css = $(el).html()?.trim();
    if (css) styles.push(css);
  });
  $('script').each((_, el) => {
    const src = $(el).attr('src');
    const inline = $(el).html()?.trim();
    if (src) scripts.push(`// external: ${src}`);
    else if (inline) scripts.push(inline);
  });

  const blob = html.toLowerCase();
  if (blob.includes('framer-motion') || blob.includes('motion.')) animationHints.add('Framer Motion (React)');
  if (blob.includes('gsap') || blob.includes('scrolltrigger')) animationHints.add('GSAP / ScrollTrigger');
  if (blob.includes('aos') || blob.includes('data-aos')) animationHints.add('AOS (Animate On Scroll)');
  if (blob.includes('@keyframes') || blob.includes('animation:')) animationHints.add('CSS @keyframes');
  if (blob.includes('lottie') || blob.includes('bodymovin')) animationHints.add('Lottie animations');
  if (blob.includes('three.js') || blob.includes('threejs')) animationHints.add('Three.js / WebGL');
  if (blob.includes('swiper')) animationHints.add('Swiper carousel');
  if (blob.includes('intersectionobserver') || blob.includes('fade-in')) animationHints.add('Scroll reveal / fade-in');

  return { styles, scripts, animationHints: [...animationHints] };
}

export function buildWordPressTheme(site: Site, options?: WordPressExportOptions): WordPressThemeExport {
  if (site.pages.length === 0) {
    throw new Error('No pages to export');
  }
  const guide = options?.styleGuide;

  const themeSlug = `freshpress-${slugify(site.meta.name)}`;
  const themeName = site.meta.name;
  const files: Record<string, string> = {};

  const allSlots: Record<string, unknown> = {};
  const allAnimationHints = new Set<string>();
  const combinedStyles: string[] = [];

  for (const page of site.pages) {
    for (const [id, slot] of Object.entries(page.content.slots)) {
      allSlots[id] = slot;
    }
    const rendered = page.content.template;
    const assets = extractAssetsFromHtml(rendered);
    assets.animationHints.forEach((h) => allAnimationHints.add(h));
    combinedStyles.push(...assets.styles);
  }

  files['style.css'] = buildStyleCss(themeName, themeSlug, combinedStyles);
  files['functions.php'] = FUNCTIONS_PHP;
  files['inc/slots.php'] = SLOTS_PHP;
  files['inc/slots.json'] = JSON.stringify(allSlots, null, 2);
  files['header.php'] = HEADER_PHP;
  files['footer.php'] = options?.watermark ? `${watermarkHtml()}\n${FOOTER_PHP}` : FOOTER_PHP;
  files['index.php'] = INDEX_PHP;

  // Mirror renderPage: stamp data-element-id so the exported override CSS has
  // its selectors, and (when themed) scope the page under .fp-page — without
  // that class every tag-level theme rule in the bundled stylesheet is dead.
  const themed = !!guide;
  const pagePhpBody = (page: SitePage) =>
    templateToPhp(
      page.content.containers
        ? injectElementIds(page.content.template, page.content.containers)
        : page.content.template
    );

  for (const page of site.pages) {
    const phpBody = pagePhpBody(page);
    const slug = pageSlug(page);

    if (page.path === '/') {
      files['front-page.php'] = buildPageTemplate(page.title, phpBody, 'Front Page', themed);
    } else {
      files[`page-${slug}.php`] = buildPageTemplate(page.title, phpBody, page.title, themed);
    }
  }

  if (!files['front-page.php']) {
    const first = site.pages[0];
    files['front-page.php'] = buildPageTemplate(first.title, pagePhpBody(first), 'Front Page', themed);
  }

  // Generated pages carry .fp-* classes in their markup; bundling the guide's
  // stylesheet restores their theme on WordPress. Ingested pages keep their own
  // inline CSS either way. Order mirrors renderPage's cascade: page inline
  // styles first, theme sheet after (wins specificity ties), per-element
  // overrides last (win against the theme).
  const inlineCss = combinedStyles.length
    ? `/* --- Exported inline page styles --- */\n${combinedStyles.join('\n\n')}`
    : '';
  const guideCss = guide
    ? `/* --- FreshPress StyleGuide theme (.fp-* classes — see THEME-NOTES.md) --- */\n${generateStyleSheet(guide)}`
    : '';
  const elementOverridesCss = site.pages
    .map((p) =>
      p.content.namedElements ? generateElementOverrides(p.content.namedElements, guide ?? undefined) : ''
    )
    .filter(Boolean)
    .join('\n');
  const overridesCss = elementOverridesCss
    ? `/* --- Per-element style overrides (Guardian-validated) --- */\n${elementOverridesCss}`
    : '';
  files['assets/theme.css'] =
    [inlineCss, guideCss, overridesCss].filter(Boolean).join('\n\n') ||
    '/* Add custom styles — exported from FreshPress frozen template */\n';

  files['INSTALL.md'] = buildInstallMd(themeName, themeSlug, site);
  files['ANIMATIONS.md'] = buildAnimationsMd([...allAnimationHints]);
  if (guide) {
    files['THEME-NOTES.md'] = buildThemeNotesMd(guide, options?.fontSubstitutesNote);
  }
  files['README.md'] = buildReadmeMd(themeName, !!guide);

  return { themeSlug, themeName, files };
}

/** Rows mirror the semantic classes generateStyleSheet emits — keep in sync. */
const FP_CLASS_TABLE = `| Class | Role |
|---|---|
| \`.fp-page\` | Page wrapper — scopes tag-level theme rules (h1–h4, p/li, a, code, img) |
| \`.fp-display-lg\` / \`.fp-display-md\` | Display headlines |
| \`.fp-h1\` … \`.fp-h4\` | Heading scale |
| \`.fp-body-lg\` / \`.fp-body\` / \`.fp-body-sm\` | Body text scale |
| \`.fp-caption\` / \`.fp-label\` | Captions and form/UI labels |
| \`.fp-btn-primary\` / \`.fp-btn-secondary\` | Buttons |
| \`.fp-card\` | Card surface |
| \`.fp-hero\` | Hero band |
| \`.fp-nav\` | Navigation bar |
| \`.fp-section\` | Section padding band |
| \`.fp-container\` | Max-width centered container |
| \`.fp-footer\` | Footer band |`;

export function buildThemeNotesMd(guide: StyleGuide, fontSubstitutesNote?: string): string {
  // meta fields can originate from AI output over scraped pages — collapse
  // whitespace so a multi-line value can't inject headings into this doc.
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
  const name = oneLine(guide.meta.name);
  const aesthetic = oneLine(guide.meta.aesthetic);
  const t = guide.typography;
  const rules = guide.designRules.trim();
  const licensing = fontSubstitutesNote?.trim()
    ? `From the source design system's own "Note on Font Substitutes":\n\n${fontSubstitutesNote.trim()}`
    : `The source design system did not document font substitutions. Verify each font's license before self-hosting; if a family is proprietary, substitute an open-source face (e.g. Inter for sans, JetBrains Mono for mono) rather than shipping the licensed one.`;

  return `# Theme Notes — ${name}

This theme bundles the site's FreshPress design system (aesthetic: ${aesthetic}).
The full token stylesheet lives in \`assets/theme.css\` and is enqueued by \`functions.php\`.

## Design rules (carried from the brand's DESIGN.md)

${rules || '_No design rules recorded for this guide._'}

## Semantic classes (\`.fp-*\`)

Exported page markup uses these classes; \`assets/theme.css\` defines them from the brand's tokens (\`--fp-*\` CSS variables).

${FP_CLASS_TABLE}

## Font stack

- Headings: ${t.headingFont}
- Body: ${t.bodyFont}
- Mono: ${t.monoFont}

## Font licensing

${licensing}
`;
}

function buildPageTemplate(title: string, bodyPhp: string, templateName: string, themed = false): string {
  return `<?php
/**
 * Template Name: ${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}
 * FreshPress export — ${templateName}
 */
get_header();
?>

<main class="freshpress-page${themed ? ' fp-page' : ''}">
${bodyPhp}
</main>

<?php get_footer(); ?>
`;
}

function buildStyleCss(themeName: string, themeSlug: string, styles: string[]): string {
  const extra = styles.length ? `\n/* --- Exported inline styles --- */\n${styles.join('\n')}\n` : '';
  return `/*
Theme Name: ${themeName}
Theme URI: ${productUrl()}
Author: FreshPress
Author URI: ${productUrl()}
Description: Custom theme exported from FreshPress CMS. Editable content slots are stored in inc/slots.json.
Version: 1.0.0
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.0
Text Domain: ${themeSlug}
*/

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}

.freshpress-page {
  min-height: 60vh;
}
${extra}`;
}

function buildInstallMd(themeName: string, themeSlug: string, site: Site): string {
  const pages = site.pages
    .map((p) => `- **${p.title}** — path \`${p.path}\` → WordPress page slug \`${pageSlug(p)}\``)
    .join('\n');

  return `# WordPress Install Guide — ${themeName}

This theme was exported from **FreshPress CMS**. The design layout is frozen in PHP templates; editable text and images live in \`inc/slots.json\`.

## 1. Upload the theme

1. Zip the \`${themeSlug}/\` folder (or upload as-is if WordPress accepts the folder).
2. In WordPress admin go to **Appearance → Themes → Add New → Upload Theme**.
3. Upload the zip and click **Install Now**, then **Activate**.

**Or via FTP/SFTP:** copy the theme folder to \`wp-content/themes/${themeSlug}/\`.

## 2. Create matching pages

Create a WordPress page for each exported route:

${pages}

For each page:
1. **Pages → Add New**
2. Set the **title** to match the list above
3. Set the **permalink/slug** to match (e.g. \`about\` for \`/about\`)
4. In the right sidebar under **Template**, choose the matching **Template Name** (same as page title)
5. Publish

## 3. Set the homepage

1. **Settings → Reading**
2. Select **A static page**
3. Choose your home page for **Homepage** (the page using \`front-page.php\`)

## 4. Permalinks

Go to **Settings → Permalinks** and click **Save** (even without changes) to flush rewrite rules.

## 5. Edit content (slots)

Default slot values are in \`inc/slots.json\`. On theme activation they load into the WordPress option \`freshpress_slots\`.

To update content programmatically:
\`\`\`php
$slots = get_option('freshpress_slots', []);
$slots['your-slot-id']['value'] = 'New headline text';
update_option('freshpress_slots', $slots);
\`\`\`

For client-friendly editing, consider:
- **Advanced Custom Fields (ACF)** — map slot IDs to field groups
- **Customiser** — extend \`functions.php\` with \`customize_register\` hooks
- Re-import from FreshPress after edits and re-upload the theme

## 6. Contact forms

If you used FreshPress contact forms, point forms to your FreshPress server or replace with:
- **Contact Form 7**
- **WPForms**
- **Gravity Forms**

## 7. Need help?

See \`ANIMATIONS.md\` for motion/animation migration tips from React sites.
`;
}

function buildAnimationsMd(hints: string[]): string {
  const detected =
    hints.length > 0
      ? hints.map((h) => `- ${h}`).join('\n')
      : '- No specific animation libraries detected in exported HTML';

  return `# Animation & Motion — React to WordPress

Your FreshPress site may have used React-based animations. WordPress themes are PHP + HTML + CSS. Use this guide to recreate similar effects.

## Detected in your export

${detected}

---

## General approach

1. **Prefer CSS first** — transitions, \`@keyframes\`, \`scroll-driven animations\` (modern browsers)
2. **Use lightweight JS plugins** only when CSS is not enough
3. **Avoid bundlers** in classic PHP themes unless you add a build step

---

## Common React → WordPress mappings

| React / npm | WordPress approach |
|-------------|-------------------|
| **Framer Motion** | CSS transitions + \`Intersection Observer\` (see \`assets/theme.css\`) or **GreenSock (GSAP)** |
| **GSAP / ScrollTrigger** | Enqueue GSAP from CDN in \`functions.php\`, or plugin **Scroll Magic** |
| **AOS (Animate On Scroll)** | Plugin **[Animate On Scroll](https://wordpress.org/plugins/animate-on-scroll/)** or copy AOS CSS/JS |
| **React Spring** | CSS \`transition\` + small vanilla JS |
| **Lottie (React)** | Plugin **Bodymovin / Lottie** or embed JSON via **Elementor** |
| **Three.js / WebGL** | **Spline** embed, static hero video, or simplified CSS parallax |
| **Swiper (React)** | Plugin **Swiper for WordPress** or enqueue Swiper.js in \`functions.php\` |
| **CSS modules / Tailwind** | Paste utility classes into \`assets/theme.css\` or use **Tailwind CLI** build |

---

## Recommended WordPress plugins

- **[Animate On Scroll](https://wordpress.org/plugins/animate-on-scroll/)** — scroll reveal (AOS-style)
- **[GreenShift](https://wordpress.org/plugins/greenshift-animation-and-page-builder-blocks/)** — CSS animations + blocks
- **[Advanced Animations](https://wordpress.org/plugins/advanced-animations/)** — lightweight motion blocks
- **Contact Form 7 / WPForms** — replace React form components

---

## CSS scroll reveal (no plugin)

Add to \`assets/theme.css\`:

\`\`\`css
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.reveal.is-visible {
  opacity: 1;
  transform: none;
}
\`\`\`

Add to \`functions.php\` (footer):

\`\`\`php
add_action('wp_footer', function () {
  echo '<script>
    const els = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("is-visible"); });
    }, { threshold: 0.15 });
    els.forEach(el => io.observe(el));
  </script>';
});
\`\`\`

Add class \`reveal\` to sections in your page templates.

---

## GSAP via CDN (advanced)

In \`functions.php\`:

\`\`\`php
function freshpress_enqueue_gsap() {
  wp_enqueue_script('gsap', 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js', [], null, true);
  wp_enqueue_script('gsap-scrolltrigger', 'https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js', ['gsap'], null, true);
}
add_action('wp_enqueue_scripts', 'freshpress_enqueue_gsap');
\`\`\`

Then add ScrollTrigger timelines in a custom \`assets/animations.js\` file.

---

## Tips

- Export hero videos instead of canvas/WebGL when possible
- Test on mobile — reduce motion with \`prefers-reduced-motion: reduce\`
- Keep animation subtle for SEO Core Web Vitals (LCP, CLS)
`;
}

function buildReadmeMd(themeName: string, hasThemeNotes: boolean): string {
  const themeNotesLine = hasThemeNotes
    ? '\n- **THEME-NOTES.md** — design rules, `.fp-*` class reference, font licensing'
    : '';
  return `# ${themeName} — FreshPress WordPress Theme

Exported from [FreshPress CMS](${productUrl()}).

- **INSTALL.md** — step-by-step WordPress setup
- **ANIMATIONS.md** — recreate React motion with CSS/plugins${themeNotesLine}
- **inc/slots.json** — editable content values
- **inc/slots.php** — \`freshpress_slot()\` renderer
`;
}

const HEADER_PHP = `<?php
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
`;

const FOOTER_PHP = `<?php wp_footer(); ?>
</body>
</html>
`;

const INDEX_PHP = `<?php
get_header();
?>
<main class="freshpress-page">
  <?php
  if (have_posts()) {
    while (have_posts()) {
      the_post();
      the_content();
    }
  }
  ?>
</main>
<?php get_footer(); ?>
`;

const SLOTS_PHP = `<?php
/**
 * FreshPress slot renderer — reads from freshpress_slots option.
 */

function freshpress_get_slots(): array {
  $slots = get_option('freshpress_slots');
  if (is_array($slots)) {
    return $slots;
  }
  $path = get_template_directory() . '/inc/slots.json';
  if (file_exists($path)) {
    $decoded = json_decode(file_get_contents($path), true);
    return is_array($decoded) ? $decoded : [];
  }
  return [];
}

function freshpress_slot(string $id): void {
  $slots = freshpress_get_slots();
  if (!isset($slots[$id]) || !is_array($slots[$id])) {
    return;
  }
  $slot = $slots[$id];
  $type = $slot['type'] ?? 'text';
  $value = $slot['value'] ?? '';

  switch ($type) {
    case 'image':
      $alt = esc_attr($slot['alt'] ?? '');
      echo '<img src="' . esc_url($value) . '" alt="' . $alt . '" />';
      break;
    case 'link':
      $href = esc_url($slot['href'] ?? '#');
      echo '<a href="' . $href . '">' . esc_html($value) . '</a>';
      break;
    case 'button':
      echo '<button type="button">' . esc_html($value) . '</button>';
      break;
    case 'text':
    default:
      echo esc_html($value);
      break;
  }
}
`;

const FUNCTIONS_PHP = `<?php
/**
 * FreshPress WordPress theme — exported from FreshPress CMS
 */

require_once get_template_directory() . '/inc/slots.php';

function freshpress_theme_setup(): void {
  add_theme_support('title-tag');
  add_theme_support('post-thumbnails');
  add_theme_support('html5', ['search-form', 'comment-form', 'gallery', 'caption', 'style', 'script']);
}
add_action('after_setup_theme', 'freshpress_theme_setup');

function freshpress_enqueue_assets(): void {
  wp_enqueue_style(
    'freshpress-theme',
    get_template_directory_uri() . '/assets/theme.css',
    [],
    '1.0.0'
  );
}
add_action('wp_enqueue_scripts', 'freshpress_enqueue_assets');

function freshpress_activate_theme(): void {
  $path = get_template_directory() . '/inc/slots.json';
  if (!file_exists($path)) {
    return;
  }
  $decoded = json_decode(file_get_contents($path), true);
  if (is_array($decoded)) {
    update_option('freshpress_slots', $decoded);
  }
}
add_action('after_switch_theme', 'freshpress_activate_theme');
`;
