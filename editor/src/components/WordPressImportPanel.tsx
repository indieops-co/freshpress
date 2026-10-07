import { useState } from 'react';
import { api, type ImportPreview, type ImportJob } from '../api';

interface Props {
  onImported: (siteId: string) => void;
}

export default function WordPressImportPanel({ onImported }: Props) {
  const [wxrFile, setWxrFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState('');

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!wxrFile) return;
    setError('');
    setPreview(null);
    setJob(null);
    try {
      const p = await api.previewWordPressImport(wxrFile);
      setPreview(p);
      setSourceUrl(p.siteUrl ?? '');
      setSelectedPages(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    }
  }

  function togglePage(slug: string) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleImport() {
    if (!wxrFile || !preview) return;
    setError('');
    setImporting(true);
    try {
      const result = await api.importWordPress(wxrFile, {
        sourceBaseUrl: sourceUrl.trim() || undefined,
        uploadsZip: zipFile ?? undefined,
        sitePageSlugs: [...selectedPages],
      });
      setJob(result.job);
      onImported(result.siteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: '1.5rem' }}>
      <h2>Create new site from WordPress export</h2>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
        Upload a WordPress Tools → Export → All content .xml file to create a new site with
        authors, categories, tags, articles, comments, and media.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handlePreview} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          WordPress export (.xml) *
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            onChange={(e) => {
              setWxrFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            required
          />
        </label>

        <button type="submit" disabled={!wxrFile}>
          Preview import
        </button>
      </form>

      {preview && (
        <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Preview: {preview.siteName}</h3>
          {preview.suggestedDomain && (
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Domain hint: {preview.suggestedDomain}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', margin: '1rem 0', fontSize: '0.85rem' }}>
            <span>Authors: {preview.counts.authors}</span>
            <span>Categories: {preview.counts.categories}</span>
            <span>Tags: {preview.counts.tags}</span>
            <span>Attachments: {preview.counts.attachments}</span>
            <span>Articles: {preview.counts.articles}</span>
            <span>Comments: {preview.counts.comments}</span>
          </div>

          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            Source WordPress URL (for media download)
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://client-site.com"
              style={{ width: '100%' }}
            />
          </label>

          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            Optional wp-content/uploads ZIP (fallback if site is offline)
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {preview.pages.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                Also create editable SitePages from these WordPress pages:
              </p>
              {preview.pages.map((p) => (
                <label key={p.slug} style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedPages.has(p.slug)}
                    onChange={() => togglePage(p.slug)}
                    style={{ marginRight: '0.5rem' }}
                  />
                  {p.title} <span style={{ color: 'var(--muted)' }}>(/{p.slug})</span>
                </label>
              ))}
            </div>
          )}

          <button type="button" onClick={handleImport} disabled={importing}>
            {importing ? 'Creating site…' : 'Create site from import'}
          </button>

          {job && job.status === 'completed' && (
            <p style={{ marginTop: '0.75rem', color: 'var(--success, green)' }}>
              Import complete — {job.stats.articles} articles, {job.stats.sitePages} SitePages
              {job.stats.mediaFailed > 0 && ` (${job.stats.mediaFailed} media files failed)`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
