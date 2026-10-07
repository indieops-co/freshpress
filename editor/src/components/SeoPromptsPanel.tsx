import { useEffect, useState } from 'react';
import { getToken } from '../api';

export interface SeoPromptSummary {
  id: string;
  number: number;
  title: string;
  description?: string;
  category: string;
}

export interface SeoPromptCollection {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  prompts: SeoPromptSummary[];
}

interface Props {
  /** When set, fetches site-scoped prompts with URL substitution */
  siteId?: string;
  pageId?: string;
  onClose?: () => void;
}

async function fetchCollections(siteId?: string): Promise<SeoPromptCollection[]> {
  const path = siteId ? `/api/sites/${siteId}/seo-prompts` : '/api/seo-prompts';
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('Failed to load SEO prompts');
  return res.json();
}

async function fetchPrompt(id: string, siteId?: string, pageId?: string) {
  const qs = pageId ? `?pageId=${encodeURIComponent(pageId)}` : '';
  const path = siteId
    ? `/api/sites/${siteId}/seo-prompts/${id}${qs}`
    : `/api/seo-prompts/${id}`;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('Failed to load prompt');
  return res.json() as Promise<{ id: string; title: string; content: string; number: number }>;
}

export default function SeoPromptsPanel({ siteId, pageId, onClose }: Props) {
  const [collections, setCollections] = useState<SeoPromptCollection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [activeTitle, setActiveTitle] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCollections(siteId)
      .then(setCollections)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  async function openPrompt(id: string, title: string) {
    setActiveId(id);
    setActiveTitle(title);
    setCopied(false);
    try {
      const prompt = await fetchPrompt(id, siteId, pageId);
      setContent(prompt.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  }

  async function copyPrompt() {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="seo-panel">
      <div className="seo-panel-header">
        <div>
          <h2>SEO audit prompts</h2>
          <p className="hint">Copy into Cursor or Claude Code — sourced from Headcheck</p>
        </div>
        {onClose && (
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="hint">Loading prompts…</p>}

      <div className="seo-panel-body">
        <div className="seo-list">
          {collections.map((col) => (
            <div key={col.id} className="seo-collection">
              <h3>{col.title}</h3>
              <p className="hint">{col.description}</p>
              <a href={col.sourceUrl} target="_blank" rel="noreferrer" className="seo-source-link">
                View on GitHub ↗
              </a>
              <ul className="slot-list">
                {col.prompts.map((p) => (
                  <li
                    key={p.id}
                    className={`slot-item ${activeId === p.id ? 'active' : ''}`}
                    onClick={() => openPrompt(p.id, p.title)}
                  >
                    <div className="tag">
                      {col.id === 'nextjs' ? 'Next.js' : 'Recipe'} #{p.number}
                    </div>
                    <div>{p.title}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="seo-viewer">
          {activeId ? (
            <>
              <div className="seo-viewer-toolbar">
                <strong>{activeTitle}</strong>
                <button type="button" onClick={copyPrompt} title="Copy prompt">
                  {copied ? '✓ Copied' : '⎘ Copy prompt'}
                </button>
              </div>
              {siteId && (
                <p className="hint" style={{ padding: '0 1rem' }}>
                  Placeholder URLs replaced with this site&apos;s domain where configured.
                </p>
              )}
              <pre className="seo-prompt-content">{content}</pre>
            </>
          ) : (
            <div className="seo-empty">Select a prompt to view and copy</div>
          )}
        </div>
      </div>
    </div>
  );
}
