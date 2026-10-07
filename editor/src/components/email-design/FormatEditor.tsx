import { useEffect, useMemo, useState } from 'react';
import { api, type EmailFormat, type SiteMeta } from '../../api';
import FormatPreview from './FormatPreview';

interface Props {
  siteId: string;
}

function provenanceLabel(format: EmailFormat): string {
  if (format.provenance.source === 'imported') return `Imported${format.provenance.sourceSiteId ? '' : ''}`;
  if (format.provenance.source === 'style-guide-sync') {
    return format.provenance.customized ? 'From site theme (customized)' : 'From site theme';
  }
  return 'Custom';
}

export default function FormatEditor({ siteId }: Props) {
  const [formats, setFormats] = useState<EmailFormat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EmailFormat | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const [showImport, setShowImport] = useState(false);
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [importSourceSiteId, setImportSourceSiteId] = useState('');
  const [importSourceFormats, setImportSourceFormats] = useState<EmailFormat[]>([]);
  const [importSourceId, setImportSourceId] = useState('');

  const selected = useMemo(() => formats.find((f) => f.id === selectedId) ?? null, [formats, selectedId]);

  async function refresh(selectId?: string) {
    const res = await api.listEmailFormats(siteId);
    setFormats(res.formats);
    if (selectId) setSelectedId(selectId);
    else if (!res.formats.find((f) => f.id === selectedId)) {
      setSelectedId(res.formats[0]?.id ?? null);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
  }, [selected]);

  async function handleNew() {
    setError('');
    try {
      const { format } = await api.createEmailFormat(siteId);
      await refresh(format.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    }
  }

  async function handleSyncFromTheme() {
    setError('');
    try {
      const { format } = await api.syncEmailFormatFromStyleGuide(siteId);
      await refresh(format.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed — does this site have a design system set up yet?');
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const { format } = await api.updateEmailFormat(siteId, draft.id, draft);
      await refresh(format.id);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError('');
    try {
      await api.deleteEmailFormat(siteId, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function handleSetDefault(id: string) {
    setError('');
    try {
      await api.setDefaultEmailFormat(siteId, id);
      await refresh(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set default');
    }
  }

  async function handleExport(id: string) {
    setError('');
    try {
      const res = await api.exportEmailFormat(siteId, id);
      await navigator.clipboard.writeText(JSON.stringify(res, null, 2));
      setStatus('Export JSON copied to clipboard');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  }

  async function openImport() {
    setShowImport(true);
    if (sites.length === 0) {
      const list = await api.listSites();
      setSites(list.filter((s) => s.id !== siteId));
    }
  }

  async function handlePickImportSite(sourceSiteId: string) {
    setImportSourceSiteId(sourceSiteId);
    setImportSourceId('');
    if (!sourceSiteId) {
      setImportSourceFormats([]);
      return;
    }
    const res = await api.listEmailFormats(sourceSiteId);
    setImportSourceFormats(res.formats);
  }

  async function handleImport() {
    if (!importSourceSiteId || !importSourceId) return;
    setError('');
    try {
      const { format } = await api.importEmailFormatFromSite(siteId, importSourceSiteId, importSourceId);
      setShowImport(false);
      await refresh(format.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  }

  function updateDraft(patch: Partial<EmailFormat>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  if (loading) return <p className="dash-page__muted">Loading formats…</p>;

  return (
    <div className="design-step__layout">
      <div className="design-step__themes">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Formats</h3>
        <ul className="design-theme-list">
          {formats.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className={`design-theme-list__item${f.id === selectedId ? ' design-theme-list__item--active' : ''}`}
                onClick={() => setSelectedId(f.id)}
              >
                <strong>
                  {f.name}
                  {f.isDefault ? ' ★' : ''}
                </strong>
                <span>{provenanceLabel(f)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button type="button" onClick={() => void handleNew()}>
            + New Format
          </button>
          <button type="button" className="secondary" onClick={() => void handleSyncFromTheme()}>
            Sync from site theme
          </button>
          <button type="button" className="secondary" onClick={() => void openImport()}>
            Import from another site
          </button>
        </div>

        {showImport && (
          <div className="panel" style={{ marginTop: '0.75rem', padding: '0.75rem' }}>
            <label>
              <span className="field-label">Source site</span>
              <select value={importSourceSiteId} onChange={(e) => void handlePickImportSite(e.target.value)}>
                <option value="">Select a site…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {importSourceFormats.length > 0 && (
              <label>
                <span className="field-label">Format</span>
                <select value={importSourceId} onChange={(e) => setImportSourceId(e.target.value)}>
                  <option value="">Select a format…</option>
                  {importSourceFormats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" disabled={!importSourceId} onClick={() => void handleImport()}>
                Import
              </button>
              <button type="button" className="secondary" onClick={() => setShowImport(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="design-step__preview">
        {error && <p className="dash-page__error">{error}</p>}
        {status && <p className="status-ok">{status}</p>}
        {!draft ? (
          <p className="dash-page__muted">Select or create a Format to edit.</p>
        ) : (
          <>
            <FormatPreview format={draft} />
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label>
                <span className="field-label">Name</span>
                <input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} />
              </label>

              <div className="settings-form-grid">
                {(Object.keys(draft.colors) as Array<keyof EmailFormat['colors']>).map((key) => (
                  <label key={key}>
                    <span className="field-label">{key}</span>
                    <input
                      type="color"
                      value={draft.colors[key]}
                      onChange={(e) => updateDraft({ colors: { ...draft.colors, [key]: e.target.value } })}
                    />
                  </label>
                ))}
              </div>

              <div className="settings-form-grid">
                <label>
                  <span className="field-label">Heading font</span>
                  <input
                    value={draft.typography.headingFont}
                    onChange={(e) =>
                      updateDraft({ typography: { ...draft.typography, headingFont: e.target.value } })
                    }
                  />
                </label>
                <label>
                  <span className="field-label">Body font</span>
                  <input
                    value={draft.typography.bodyFont}
                    onChange={(e) => updateDraft({ typography: { ...draft.typography, bodyFont: e.target.value } })}
                  />
                </label>
              </div>

              <div className="settings-form-grid">
                <label>
                  <span className="field-label">Gutter (outer padding)</span>
                  <input
                    value={draft.spacing.gutter}
                    onChange={(e) => updateDraft({ spacing: { ...draft.spacing, gutter: e.target.value } })}
                  />
                </label>
                <label>
                  <span className="field-label">Section gap</span>
                  <input
                    value={draft.spacing.sectionGap}
                    onChange={(e) => updateDraft({ spacing: { ...draft.spacing, sectionGap: e.target.value } })}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" disabled={saving} onClick={() => void handleSave()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="secondary" onClick={() => void handleSetDefault(draft.id)}>
                  Set as default
                </button>
                <button type="button" className="secondary" onClick={() => void handleExport(draft.id)}>
                  Export
                </button>
                <button type="button" className="danger" onClick={() => void handleDelete(draft.id)}>
                  Delete
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
