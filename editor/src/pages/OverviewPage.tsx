import { useState } from 'react';
import { api } from '../api';
import WordPressImportPanel from '../components/WordPressImportPanel';

interface Props {
  siteId: string | null;
  siteName?: string;
  onSiteCreated: () => void;
  onImported: (siteId: string) => void;
  onError: (message: string) => void;
}

export default function OverviewPage({
  siteId,
  siteName,
  onSiteCreated,
  onImported,
  onError,
}: Props) {
  const [ingestUrl, setIngestUrl] = useState('');

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!siteId || !ingestUrl.trim()) return;
    try {
      await api.ingestPage(siteId, ingestUrl.trim());
      setIngestUrl('');
      onSiteCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Ingest failed');
    }
  }

  if (!siteId) {
    return (
      <div className="dash-page">
        <h2 className="dash-page__title">Welcome to FreshPress</h2>
        <p className="dash-page__lead">No client sites yet.</p>
        <p className="dash-page__muted">
          Use <strong>+ Add Site</strong> in the sidebar to create a site, or import from WordPress below.
        </p>
        <WordPressImportPanel onImported={onImported} />
      </div>
    );
  }

  // Chunk 9: the design-setup onboarding branch that used to live here moved
  // into the create-site wizard (CreateSiteFlow); Overview keeps ingest + import.
  return (
    <div className="dash-page">
      <h2 className="dash-page__title">{siteName ?? 'Site overview'}</h2>
      <p className="dash-page__muted">Quick actions for the selected client site.</p>

      <div className="panel" style={{ marginTop: '1.25rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Ingest page URL</h3>
        <form onSubmit={handleIngest} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            value={ingestUrl}
            onChange={(e) => setIngestUrl(e.target.value)}
            placeholder="https://example.com"
            style={{ flex: '1 1 240px' }}
          />
          <button type="submit">Ingest</button>
        </form>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>WordPress import</h3>
        <WordPressImportPanel onImported={onImported} />
      </div>
    </div>
  );
}
