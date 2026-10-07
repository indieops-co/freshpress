import type { EmailFormat } from '../../api';

interface Props {
  format: EmailFormat;
}

/** Non-interactive mock of an email rendered with this Format's tokens — mirrors ThemePreview.tsx. */
export default function FormatPreview({ format }: Props) {
  const c = format.colors;
  const t = format.typography;

  return (
    <div
      className="email-format-preview"
      style={{
        background: c.background,
        padding: format.spacing.gutter,
        borderRadius: '12px',
        border: `1px solid ${c.border}`,
      }}
    >
      <div
        style={{
          background: c.surface,
          borderRadius: '8px',
          padding: '1.25rem',
          fontFamily: t.bodyFont,
        }}
      >
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
          {[c.primary, c.secondary, c.accent, c.surface, c.text].map((color) => (
            <div
              key={color}
              title={color}
              style={{ width: 24, height: 24, borderRadius: 6, background: color, border: `1px solid ${c.border}` }}
            />
          ))}
        </div>
        <p
          style={{
            fontFamily: t.headingFont,
            fontWeight: t.headingWeight,
            fontSize: t.h2Size,
            color: c.text,
            margin: `0 0 ${format.spacing.paragraphGap}`,
          }}
        >
          Sample heading
        </p>
        <p
          style={{
            fontSize: t.bodySize,
            lineHeight: t.lineHeight,
            color: c.text,
            margin: `0 0 ${format.spacing.sectionGap}`,
          }}
        >
          This is how paragraph text looks with this Format's fonts, colors, and spacing.
        </p>
        <button
          type="button"
          style={{
            background: format.button.background,
            color: format.button.textColor,
            borderRadius: format.button.radius,
            fontWeight: format.button.fontWeight,
            padding: `${format.spacing.buttonPaddingY} ${format.spacing.buttonPaddingX}`,
            border: 'none',
          }}
        >
          Call to action
        </button>
      </div>
    </div>
  );
}
