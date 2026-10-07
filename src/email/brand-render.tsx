import type { ReactNode } from 'react';
import { render } from '@react-email/render';
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Preview, Section, Text } from '@react-email/components';
import type { EmailFormat } from '../design/email-format.js';
import type { EmailBlock, EmailTemplate } from '../design/email-template.js';
import type { SiteSignatureConfig } from '../storage/types.js';
import { buildPlainEmailTemplate } from '../design/email-template.js';

export interface ComposeInput {
  format: EmailFormat;
  template: EmailTemplate;
  subject: string;
  previewText?: string;
  /** Semantic HTML from the compose editor (TipTap output) — sanitized before insertion. */
  bodyHtml: string;
  includeBrand: boolean;
  includeSignature: boolean;
  signature?: SiteSignatureConfig;
  siteName: string;
  logoUrl?: string;
}

const BODY_PLACEHOLDER = '%%EMAIL_BODY%%';

/**
 * SVG logo? (by path extension, or an svg data: URI). Gmail and Outlook desktop don't
 * render SVG in <img>, so the header-logo block falls back to the site name instead.
 */
export function isSvgImageUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^data:image\/svg/i.test(trimmed) || /\.svgz?$/i.test(trimmed.split(/[?#]/)[0]);
}

// TipTap StarterKit only ever emits p/h1-h6/strong/em/s/u/ul/ol/li/a/blockquote/code/pre/hr/br,
// so an allowlist-style strip of the dangerous bits is sufficient — this is not a general-purpose
// HTML sanitizer and should not be used on arbitrary untrusted input from outside the compose UI.
export function sanitizeEmailBodyHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

// Readable full-body plain-text conversion for "Send as Plain Text Only" — unlike textSnippet()
// in email-inbound-webhook.ts, this preserves paragraph/list structure rather than truncating.
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");

  return withBreaks
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Format field -> react-email target mapping (the literal implementation spec):
 *
 * | Format field                        | react-email target                          |
 * |--------------------------------------|----------------------------------------------|
 * | spacing.gutter                       | Container.style.padding                      |
 * | colors.background                    | Body.style.backgroundColor                   |
 * | colors.surface                       | Container.style.backgroundColor              |
 * | colors.text / colors.textMuted       | Text.style.color                             |
 * | typography.bodyFont / headingFont    | style.fontFamily (already email-safe stacks) |
 * | typography.h1Size / bodySize         | Heading/Text style.fontSize                  |
 * | spacing.sectionGap                   | margin between Section blocks                |
 * | button.*                             | Button.style                                 |
 * | colors.border                        | Hr.style.borderColor                         |
 */
function renderBlock(block: EmailBlock, format: EmailFormat, input: ComposeInput): ReactNode {
  const key = block.id;
  switch (block.kind) {
    case 'header-logo':
      return (
        <Section key={key} style={{ textAlign: 'center', paddingBottom: format.spacing.sectionGap }}>
          {input.logoUrl && !isSvgImageUrl(input.logoUrl) ? (
            <Img src={input.logoUrl} alt={input.siteName} style={{ margin: '0 auto', maxHeight: '40px' }} />
          ) : (
            <Text
              style={{
                fontFamily: format.typography.headingFont,
                fontWeight: format.typography.headingWeight,
                color: format.colors.text,
                margin: 0,
              }}
            >
              {input.siteName}
            </Text>
          )}
        </Section>
      );
    case 'heading':
      return (
        <Heading
          key={key}
          style={{
            fontFamily: format.typography.headingFont,
            fontWeight: format.typography.headingWeight,
            fontSize: format.typography.h1Size,
            color: format.colors.text,
            margin: `0 0 ${format.spacing.paragraphGap}`,
          }}
        >
          {input.subject}
        </Heading>
      );
    case 'body':
      // Placeholder swapped for sanitized bodyHtml after render() — see renderBrandedEmail.
      return (
        <Section
          key={key}
          style={{
            fontFamily: format.typography.bodyFont,
            fontWeight: format.typography.bodyWeight,
            fontSize: format.typography.bodySize,
            lineHeight: format.typography.lineHeight,
            color: format.colors.text,
            marginBottom: format.spacing.sectionGap,
          }}
        >
          {BODY_PLACEHOLDER}
        </Section>
      );
    case 'cta-button': {
      const label = typeof block.config.label === 'string' ? block.config.label : 'Learn more';
      const href = typeof block.config.href === 'string' ? block.config.href : '#';
      return (
        <Section key={key} style={{ textAlign: 'center', marginBottom: format.spacing.sectionGap }}>
          <Button
            href={href}
            style={{
              backgroundColor: format.button.background,
              color: format.button.textColor,
              borderRadius: format.button.radius,
              fontWeight: format.button.fontWeight,
              padding: `${format.spacing.buttonPaddingY} ${format.spacing.buttonPaddingX}`,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            {label}
          </Button>
        </Section>
      );
    }
    case 'divider':
      return <Hr key={key} style={{ borderColor: format.colors.border, margin: `${format.spacing.sectionGap} 0` }} />;
    case 'signature-slot': {
      if (!input.includeSignature || !input.signature) return null;
      const sig = input.signature;
      const lines = [sig.name, [sig.title, sig.company].filter(Boolean).join(', '), sig.phone].filter(Boolean);
      return (
        <Section key={key} style={{ marginBottom: format.spacing.sectionGap }}>
          {lines.map((line, i) => (
            <Text
              key={i}
              style={{
                fontFamily: format.typography.bodyFont,
                fontSize: format.typography.smallSize,
                color: format.colors.textMuted,
                margin: 0,
              }}
            >
              {line}
            </Text>
          ))}
          {sig.extraHtml && (
            <Text style={{ fontSize: format.typography.smallSize, color: format.colors.textMuted }}>
              {sig.extraHtml}
            </Text>
          )}
        </Section>
      );
    }
    case 'footer': {
      const showPoweredBy = block.config.showPoweredBy !== false;
      if (!showPoweredBy) return null;
      return (
        <Text
          key={key}
          style={{
            fontFamily: format.typography.bodyFont,
            fontSize: format.typography.smallSize,
            color: format.colors.textMuted,
            textAlign: 'center',
            marginTop: format.spacing.sectionGap,
          }}
        >
          Powered by FreshPress
        </Text>
      );
    }
    default:
      return null;
  }
}

export async function renderBrandedEmail(input: ComposeInput): Promise<string> {
  const sanitizedBody = sanitizeEmailBodyHtml(input.bodyHtml);

  if (!input.includeBrand) {
    const plainTemplate = buildPlainEmailTemplate(input.format.siteId);
    const html = await render(
      <Html>
        <Head />
        {input.previewText && <Preview>{input.previewText}</Preview>}
        <Body style={{ fontFamily: input.format.typography.bodyFont }}>
          <Container style={{ maxWidth: plainTemplate.maxWidth, padding: input.format.spacing.gutter }}>
            <Section>{BODY_PLACEHOLDER}</Section>
          </Container>
        </Body>
      </Html>
    );
    return html.replace(BODY_PLACEHOLDER, sanitizedBody);
  }

  const { format, template } = input;
  const html = await render(
    <Html>
      <Head />
      {input.previewText && <Preview>{input.previewText}</Preview>}
      <Body style={{ backgroundColor: format.colors.background, fontFamily: format.typography.bodyFont }}>
        <Container
          style={{
            maxWidth: template.maxWidth,
            padding: format.spacing.gutter,
            backgroundColor: format.colors.surface,
          }}
        >
          {template.blocks.map((block) => renderBlock(block, format, input))}
        </Container>
      </Body>
    </Html>
  );
  return html.replace(BODY_PLACEHOLDER, sanitizedBody);
}
