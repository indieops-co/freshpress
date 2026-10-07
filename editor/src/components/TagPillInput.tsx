import { useState, type KeyboardEvent } from 'react';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  maxTags?: number;
  disabled?: boolean;
}

function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '');
}

export default function TagPillInput({ tags, onChange, maxTags, disabled }: Props) {
  const [input, setInput] = useState('');

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    const lower = tag.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) return;
    if (maxTags && tags.length >= maxTags) return;
    onChange([...tags, tag]);
    setInput('');
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }

  const preview = tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ');

  return (
    <div className="tag-pill-input">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.35rem',
          alignItems: 'center',
          padding: '0.5rem',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          background: 'var(--surface)',
        }}
      >
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              background: 'var(--border)',
              fontSize: '0.85rem',
            }}
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(i)}
                aria-label={`Remove ${tag}`}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                  fontSize: '1rem',
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (!maxTags || tags.length < maxTags) && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={tags.length ? 'Add tag…' : 'Type tag, press Enter'}
            style={{
              border: 'none',
              outline: 'none',
              flex: '1 1 120px',
              minWidth: '100px',
              background: 'transparent',
            }}
          />
        )}
      </div>
      {preview && (
        <p className="dash-page__muted" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
          Preview: {preview}
        </p>
      )}
    </div>
  );
}
