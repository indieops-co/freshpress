import type { StyleGuidePreview } from '../../api';

export type { StyleGuidePreview };

interface Props {
  guide: StyleGuidePreview;
  /**
   * The server-generated theme stylesheet (generateStyleSheet output). When
   * present, specimens render through the real .fp-* classes — the same CSS
   * that styles published pages — instead of hand-mapped inline styles.
   */
  stylesheet?: string;
}

export default function ThemePreview({ guide, stylesheet }: Props) {
  const c = guide.colors;
  const btn = guide.components.button;
  const card = guide.components.card;

  const swatches = (
    <div style={{ padding: '1.25rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {[c.primary, c.secondary, c.accent, c.surface, c.text].map((color) => (
        <div
          key={color}
          title={color}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: color,
            border: `1px solid ${c.border}`,
          }}
        />
      ))}
    </div>
  );

  const header = (
    <div className="theme-preview__header" style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${c.border}` }}>
      <strong style={{ fontFamily: guide.typography.headingFont }}>{guide.meta.name}</strong>
      <p style={{ margin: '0.35rem 0 0', color: c.textMuted, fontSize: '0.9rem' }}>{guide.meta.aesthetic}</p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>{guide.meta.designPhilosophy}</p>
    </div>
  );

  if (stylesheet) {
    return (
      <div
        className="theme-preview"
        style={{
          background: c.background,
          color: c.text,
          borderRadius: '12px',
          border: `1px solid ${c.border}`,
          overflow: 'hidden',
        }}
      >
        <style>{stylesheet}</style>
        {header}
        {swatches}
        <div className="fp-page" style={{ padding: '0 1.25rem 1.25rem' }}>
          <div className="fp-card">
            <h3 className="fp-h3" style={{ margin: '0 0 0.5rem' }}>Ship faster.</h3>
            <p className="fp-body" style={{ margin: '0 0 1rem', color: 'var(--fp-text-muted)' }}>
              Real elements rendered with this theme&rsquo;s stylesheet — exactly what published pages get.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="fp-btn-primary">Get Started</button>
              <button type="button" className="fp-btn-secondary">Learn more</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for callers without a server stylesheet: hand-mapped inline tokens.
  return (
    <div
      className="theme-preview"
      style={{
        background: c.background,
        color: c.text,
        fontFamily: guide.typography.bodyFont,
        borderRadius: '12px',
        border: `1px solid ${c.border}`,
        overflow: 'hidden',
      }}
    >
      {header}
      {swatches}
      <div style={{ padding: '0 1.25rem 1.25rem' }}>
        <div
          style={{
            background: c.surface,
            borderRadius: card.radius,
            border: card.border,
            boxShadow: card.shadow,
            padding: '1.5rem',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontFamily: guide.typography.headingFont, fontSize: '1.5rem' }}>
            Ship faster.
          </h3>
          <p style={{ margin: '0 0 1rem', color: c.textMuted }}>Preview headline and body using this style guide.</p>
          <button
            type="button"
            style={{
              background: btn.primaryBg,
              color: btn.primaryText,
              borderRadius: btn.primaryRadius,
              border: 'none',
              padding: '10px 20px',
              fontWeight: 600,
            }}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
