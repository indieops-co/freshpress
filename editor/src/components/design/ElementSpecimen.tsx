import type { ReactNode } from 'react';

interface Props {
  /** Human-facing chip label: "InfoCard", "Title / h1", "Button · Primary". */
  label: string;
  /** The elementType scope this specimen sets when clicked (usually === label). */
  elementType: string;
  selected: boolean;
  onSelect: (elementType: string) => void;
  /** Real .fp-*-classed markup — the actual live-styled element this token controls. */
  children: ReactNode;
}

/**
 * One specimen on the Site Theme page (Amendment E). Renders a REAL `.fp-*` element (styled by
 * the live theme stylesheet, exactly what published pages get — never a swatch or inline-style
 * approximation) with a clickable label chip. Clicking the chip or the specimen sets the chat/panel
 * scope to this element type. Plain React onClick — no PreviewBridge/iframe needed here.
 */
export default function ElementSpecimen({ label, elementType, selected, onSelect, children }: Props) {
  return (
    <div
      className={`element-specimen${selected ? ' element-specimen--selected' : ''}`}
      onClick={() => onSelect(elementType)}
      style={{
        position: 'relative',
        border: `1px solid ${selected ? 'var(--accent, #6c8cff)' : 'var(--border)'}`,
        outline: selected ? '2px solid var(--accent, #6c8cff)' : 'none',
        borderRadius: '10px',
        padding: '2rem 1rem 1rem',
        background: 'var(--surface)',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        className="element-specimen__chip"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(elementType);
        }}
        style={{
          position: 'absolute',
          top: '0.5rem',
          left: '0.5rem',
          fontSize: '0.72rem',
          fontWeight: 600,
          padding: '0.15rem 0.5rem',
          borderRadius: '999px',
          border: 'none',
          cursor: 'pointer',
          background: selected ? 'var(--accent, #6c8cff)' : 'var(--border)',
          color: selected ? '#fff' : 'inherit',
        }}
      >
        {label}
      </button>
      {/* .fp-page wrapper so tag-level and .fp-* rules from the theme stylesheet resolve. */}
      <div className="fp-page" style={{ background: 'transparent' }}>
        {children}
      </div>
    </div>
  );
}
