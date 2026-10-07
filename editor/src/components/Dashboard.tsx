import { useEffect, useState } from 'react';
import { api, type SiteMeta } from '../api';
import SeoPromptsPanel from './SeoPromptsPanel';
import EmailSettingsPanel from './EmailSettingsPanel';
import WordPressImportPanel from './WordPressImportPanel';

interface Props {
  onOpenSite: (siteId: string) => void;
  onLogout: () => void;
}

export default function Dashboard({ onOpenSite, onLogout }: Props) {
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSeo, setShowSeo] = useState(false);
  const [emailSite, setEmailSite] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const site = await api.createSite(name.trim(), domain.trim() || undefined);
      setSites((s) => [site.meta, ...s]);
      setName('');
      setDomain('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSite || !ingestUrl.trim()) return;
    try {
      await api.ingestPage(selectedSite, ingestUrl.trim());
      setIngestUrl('');
      alert('Page ingested successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    }
  }

  async function downloadWordPress(siteId: string, siteName: string) {
    setError('');
    try {
      await api.downloadWordPressTheme(siteId, siteName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WordPress export failed');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>FreshPress Dashboard</h1>
        <div className="spacer" />
        <button className="secondary" onClick={() => setShowSeo(true)}>
          SEO prompts
        </button>
        <button className="secondary" onClick={onLogout}>
          Sign out
        </button>
      </header>

      <div className="dashboard">
        {error && <div className="error-banner">{error}</div>}

        <WordPressImportPanel
          onImported={(siteId) => {
            void api.listSites().then(setSites);
            onOpenSite(siteId);
          }}
        />

        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>New site</h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Site name"
              style={{ flex: '1 1 200px' }}
            />
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain (optional)"
              style={{ flex: '1 1 200px' }}
            />
            <button type="submit">Create</button>
          </form>
        </div>

        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>Ingest page URL</h2>
          <form onSubmit={handleIngest} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              value={selectedSite ?? ''}
              onChange={(e) => setSelectedSite(e.target.value || null)}
              style={{ flex: '0 0 180px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '0.5rem' }}
            >
              <option value="">Select site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              value={ingestUrl}
              onChange={(e) => setIngestUrl(e.target.value)}
              placeholder="https://example.com"
              style={{ flex: '1 1 240px' }}
            />
            <button type="submit">Ingest</button>
          </form>
        </div>

        <h2 style={{ fontSize: '1.1rem' }}>Your sites</h2>
        {loading ? (
          <p style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : sites.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No sites yet — create one above.</p>
        ) : (
          <div className="site-grid">
            {sites.map((site) => (
              <div key={site.id} className="site-card">
                <div style={{ flex: 1 }} onClick={() => onOpenSite(site.id)}>
                  <strong>{site.name}</strong>
                  {site.domain && (
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{site.domain}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadWordPress(site.id, site.name);
                  }}
                >
                  WordPress
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmailSite({ id: site.id, name: site.name });
                  }}
                >
                  Email
                </button>
                <code
                  style={{ fontSize: '0.75rem', color: 'var(--muted)', cursor: 'pointer' }}
                  onClick={() => onOpenSite(site.id)}
                >
                  {site.id}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSeo && (
        <div className="seo-modal-backdrop" onClick={() => setShowSeo(false)}>
          <div className="seo-modal" onClick={(e) => e.stopPropagation()}>
            <SeoPromptsPanel onClose={() => setShowSeo(false)} />
          </div>
        </div>
      )}
      {emailSite && (
        <div className="seo-modal-backdrop" onClick={() => setEmailSite(null)}>
          <div className="seo-modal" onClick={(e) => e.stopPropagation()}>
            <EmailSettingsPanel
              siteId={emailSite.id}
              siteName={emailSite.name}
              onClose={() => setEmailSite(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
