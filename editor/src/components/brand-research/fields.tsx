/**
 * Small shared field editors. Born for the Deep Brand Research doc panels;
 * the create-site wizard (CreateSiteFlow) consumes them too — treat as a
 * shared intake surface, not brand-research-private.
 */

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'block', marginBottom: '0.75rem' }}>
      <span className="dash-page__muted" style={{ display: 'block', marginBottom: '0.25rem' }}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }} />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label style={{ display: 'block', marginBottom: '0.75rem' }}>
      <span className="dash-page__muted" style={{ display: 'block', marginBottom: '0.25rem' }}>
        {label}
        {maxLength ? ` (${value.length}/${maxLength})` : ''}
      </span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', fontFamily: 'inherit' }}
      />
    </label>
  );
}

/** Editable list of one-line strings (pain points, USPs, quotes…). */
export function ListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  function setItem(i: number, value: string) {
    onChange(items.map((item, idx) => (idx === i ? value : item)));
  }
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <span className="dash-page__muted" style={{ display: 'block', marginBottom: '0.25rem' }}>{label}</span>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <input
            type="text"
            value={item}
            placeholder={placeholder}
            onChange={(e) => setItem(i, e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="secondary" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...items, ''])}>
        + Add
      </button>
    </div>
  );
}
