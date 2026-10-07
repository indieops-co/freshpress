import { useState } from 'react';

interface Props {
  bodyText: string;
  tags: string[];
  blogUrl?: string;
  images?: {
    hero?: string;
    textCardLight?: string;
    textCardDark?: string;
  };
}

function slugifyTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

function buildHashtagLine(tags: string[]): string {
  return tags
    .map(slugifyTag)
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(' ');
}

function buildFullPost(bodyText: string, tags: string[]): string {
  const hashtags = buildHashtagLine(tags);
  if (!hashtags) return bodyText.trim();
  return `${bodyText.trim()}\n\n${hashtags}`;
}

async function copyText(text: string, onDone: () => void) {
  await navigator.clipboard.writeText(text);
  onDone();
}

export default function SocialCopyPanel({ bodyText, tags, blogUrl, images }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function flash(key: string) {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  const rows: Array<{ key: string; label: string; text: string }> = [
    { key: 'caption', label: 'Copy caption', text: bodyText.trim() },
    { key: 'hashtags', label: 'Copy hashtags', text: buildHashtagLine(tags) },
    { key: 'full', label: 'Copy full post', text: buildFullPost(bodyText, tags) },
  ];

  if (blogUrl) {
    rows.push({ key: 'link', label: 'Copy link', text: blogUrl });
  }

  const imageRows: Array<{ key: string; label: string; url: string }> = [];
  if (images?.hero) imageRows.push({ key: 'hero', label: 'Hero image URL', url: images.hero });
  if (images?.textCardLight)
    imageRows.push({ key: 'light', label: 'Light card URL', url: images.textCardLight });
  if (images?.textCardDark)
    imageRows.push({ key: 'dark', label: 'Dark card URL', url: images.textCardDark });

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h4 style={{ marginTop: 0 }}>Copy to clipboard</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.map((row) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="secondary"
              disabled={!row.text}
              onClick={() => void copyText(row.text, () => flash(row.key))}
            >
              {copiedKey === row.key ? 'Copied!' : row.label}
            </button>
            {row.text && (
              <span className="dash-page__muted" style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.text.slice(0, 60)}
                {row.text.length > 60 ? '…' : ''}
              </span>
            )}
          </div>
        ))}
      </div>

      {imageRows.length > 0 && (
        <>
          <h4 style={{ marginTop: '1rem' }}>Images</h4>
          {imageRows.map((row) => (
            <div
              key={row.key}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}
            >
              {row.url.startsWith('http') || row.url.startsWith('/') ? (
                <img
                  src={row.url}
                  alt=""
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
                />
              ) : null}
              <button
                type="button"
                className="secondary"
                onClick={() => void copyText(row.url, () => flash(row.key))}
              >
                {copiedKey === row.key ? 'Copied!' : `Copy ${row.label}`}
              </button>
              <a href={row.url} target="_blank" rel="noreferrer" className="dash-page__muted" style={{ fontSize: '0.8rem' }}>
                Download
              </a>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export { buildHashtagLine, buildFullPost, slugifyTag };
