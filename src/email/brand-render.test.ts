import { describe, it, expect } from 'vitest';
import { buildBlankEmailFormat } from '../design/email-format.js';
import { buildDefaultEmailTemplate, buildPlainEmailTemplate } from '../design/email-template.js';
import { renderBrandedEmail, sanitizeEmailBodyHtml, htmlToPlainText } from './brand-render.js';

describe('sanitizeEmailBodyHtml', () => {
  it('strips script tags', () => {
    const out = sanitizeEmailBodyHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>hi</p>');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeEmailBodyHtml('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain('onclick');
  });

  it('neutralizes javascript: URLs', () => {
    const out = sanitizeEmailBodyHtml('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toContain('javascript:');
  });

  it('leaves normal TipTap-style HTML untouched', () => {
    const html = '<p>Hello <strong>world</strong></p><ul><li>one</li></ul>';
    expect(sanitizeEmailBodyHtml(html)).toBe(html);
  });
});

describe('renderBrandedEmail', () => {
  const format = buildBlankEmailFormat('site1', 'ef_1', 'Test Format');
  const template = buildDefaultEmailTemplate('site1', 'et_1', 'Test Template');

  it('inlines Format colors/fonts/spacing into the rendered HTML when includeBrand is on', async () => {
    const html = await renderBrandedEmail({
      format,
      template,
      subject: 'Hello there',
      bodyHtml: '<p>Body content</p>',
      includeBrand: true,
      includeSignature: false,
      siteName: 'Acme',
    });
    expect(html).toContain(format.colors.background);
    expect(html).toContain(format.colors.surface);
    expect(html).toContain(format.spacing.gutter);
    expect(html).toContain('Body content');
    expect(html).toContain('Hello there');
  });

  it('sanitizes bodyHtml before insertion', async () => {
    const html = await renderBrandedEmail({
      format,
      template,
      subject: 'Hi',
      bodyHtml: '<p>Safe</p><script>alert(1)</script>',
      includeBrand: true,
      includeSignature: false,
      siteName: 'Acme',
    });
    expect(html).not.toContain('<script');
    expect(html).toContain('Safe');
  });

  it('skips the Format/Template wrapper entirely when includeBrand is off', async () => {
    const plain = buildPlainEmailTemplate('site1');
    const html = await renderBrandedEmail({
      format,
      template: plain,
      subject: 'Hi',
      bodyHtml: '<p>Just the body</p>',
      includeBrand: false,
      includeSignature: false,
      siteName: 'Acme',
    });
    expect(html).toContain('Just the body');
    expect(html).not.toContain(format.button.background);
  });

  it('only renders the signature block when includeSignature is on', async () => {
    const withSig = await renderBrandedEmail({
      format,
      template,
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
      includeBrand: true,
      includeSignature: true,
      signature: { name: 'Jane Doe', title: 'Founder' },
      siteName: 'Acme',
    });
    expect(withSig).toContain('Jane Doe');

    const withoutSig = await renderBrandedEmail({
      format,
      template,
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
      includeBrand: true,
      includeSignature: false,
      signature: { name: 'Jane Doe', title: 'Founder' },
      siteName: 'Acme',
    });
    expect(withoutSig).not.toContain('Jane Doe');
  });

  it('renders a raster logo as the header <img>', async () => {
    const html = await renderBrandedEmail({
      format,
      template,
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
      includeBrand: true,
      includeSignature: false,
      siteName: 'Acme',
      logoUrl: 'https://app.example.com/media/site1/wp-content/uploads/logo.png',
    });
    expect(html).toMatch(/<img[^>]+src="https:\/\/app\.example\.com\/media\/site1\/wp-content\/uploads\/logo\.png"/);
  });

  // Gmail and Outlook desktop don't render SVG in <img> — a broken header is worse than the name.
  it.each([
    'https://app.example.com/media/site1/wp-content/uploads/logo.svg',
    'https://app.example.com/media/site1/wp-content/uploads/logo.SVG?v=2',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('never emits an SVG <img>; falls back to the site name (%s)', async (logoUrl) => {
    const html = await renderBrandedEmail({
      format,
      template,
      subject: 'Hi',
      bodyHtml: '<p>Body</p>',
      includeBrand: true,
      includeSignature: false,
      siteName: 'Acme',
      logoUrl,
    });
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('Acme');
  });
});

describe('htmlToPlainText', () => {
  it('converts paragraphs to blank-line-separated text', () => {
    const out = htmlToPlainText('<p>First paragraph.</p><p>Second paragraph.</p>');
    expect(out).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('turns list items into bullet lines', () => {
    const out = htmlToPlainText('<ul><li>One</li><li>Two</li></ul>');
    expect(out).toBe('• One\n\n• Two');
  });

  it('converts <br> to a single newline without adding a blank line', () => {
    const out = htmlToPlainText('<p>Line one<br>Line two</p>');
    expect(out).toBe('Line one\nLine two');
  });

  it('decodes common HTML entities', () => {
    const out = htmlToPlainText('<p>Tom &amp; Jerry &mdash;&nbsp;&quot;fun&quot;</p>'.replace('&mdash;', '-'));
    expect(out).toBe('Tom & Jerry - "fun"');
  });

  it('strips scripts/styles and collapses excess blank lines', () => {
    const out = htmlToPlainText('<style>p{color:red}</style><p>A</p>\n\n\n<p>B</p><script>alert(1)</script>');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('alert');
    expect(out).toBe('A\n\nB');
  });
});
