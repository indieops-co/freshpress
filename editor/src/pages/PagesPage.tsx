import { useEffect, useState } from 'react';
import { api, type Site } from '../api';
import { useDashboard } from '../context/DashboardContext';

interface Props {
  siteId: string;
}

export default function PagesPage({ siteId }: Props) {
  const { setActiveSiteSection } = useDashboard();
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getSite(siteId)
      .then(setSite)
      .catch((e) => setError(e.message));
  }, [siteId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!site) return <p className="dash-page__muted">Loading pages…</p>;

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Pages</h2>
      <p className="dash-page__muted">{site.pages.length} page(s) in this site.</p>
      {site.pages.length === 0 ? (
        <div className="panel dash-placeholder">
          <p>No pages yet — ingest a URL from Overview.</p>
        </div>
      ) : (
        <ul className="dash-list">
          {site.pages.map((page) => (
            <li key={page.id} className="dash-list__item panel">
              <div>
                <strong>{page.title}</strong>
                <div className="dash-page__muted">{page.path}</div>
              </div>
              <button type="button" onClick={() => setActiveSiteSection('editor')}>
                Open in Editor
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
