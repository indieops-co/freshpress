import { useEffect, useState } from 'react';
import { api, type EmailFormat, type EmailTemplate, type SiteEmailBrandDefaults } from '../../api';

interface Props {
  siteId: string;
}

const BLANK: SiteEmailBrandDefaults = {
  includeBrandDefault: true,
  includeSignatureDefault: true,
  signature: {},
};

export default function BrandDefaultsPanel({ siteId }: Props) {
  const [formats, setFormats] = useState<EmailFormat[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [draft, setDraft] = useState<SiteEmailBrandDefaults>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.listEmailFormats(siteId), api.listEmailTemplates(siteId), api.getEmailBrandDefaults(siteId)])
      .then(([fRes, tRes, dRes]) => {
        setFormats(fRes.formats);
        setTemplates(tRes.templates);
        setDraft({ ...BLANK, ...dRes.brandDefaults });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const { brandDefaults } = await api.updateEmailBrandDefaults(siteId, draft);
      setDraft(brandDefaults);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="dash-page__muted">Loading…</p>;

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Brand Defaults</h3>
      <p className="dash-page__muted">
        Defaults used when composing a new email for this site — always overridable per email.
      </p>

      <label>
        <span className="field-label">Default Format</span>
        <select
          value={draft.activeFormatId ?? ''}
          onChange={(e) => setDraft({ ...draft, activeFormatId: e.target.value || undefined })}
        >
          <option value="">— none —</option>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="field-label">Default Template</span>
        <select
          value={draft.activeTemplateId ?? ''}
          onChange={(e) => setDraft({ ...draft, activeTemplateId: e.target.value || undefined })}
        >
          <option value="">— none —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="humanize-panel__review-opt" style={{ marginTop: '0.75rem' }}>
        <input
          type="checkbox"
          checked={draft.includeBrandDefault}
          onChange={(e) => setDraft({ ...draft, includeBrandDefault: e.target.checked })}
        />
        Include Brand by default
      </label>
      <label className="humanize-panel__review-opt">
        <input
          type="checkbox"
          checked={draft.includeSignatureDefault}
          onChange={(e) => setDraft({ ...draft, includeSignatureDefault: e.target.checked })}
        />
        Include Signature by default
      </label>

      <h4 style={{ margin: '1rem 0 0.5rem' }}>Signature</h4>
      <div className="settings-form-grid">
        <label>
          <span className="field-label">Name</span>
          <input
            value={draft.signature?.name ?? ''}
            onChange={(e) => setDraft({ ...draft, signature: { ...draft.signature, name: e.target.value } })}
          />
        </label>
        <label>
          <span className="field-label">Title</span>
          <input
            value={draft.signature?.title ?? ''}
            onChange={(e) => setDraft({ ...draft, signature: { ...draft.signature, title: e.target.value } })}
          />
        </label>
        <label>
          <span className="field-label">Company</span>
          <input
            value={draft.signature?.company ?? ''}
            onChange={(e) => setDraft({ ...draft, signature: { ...draft.signature, company: e.target.value } })}
          />
        </label>
        <label>
          <span className="field-label">Phone</span>
          <input
            value={draft.signature?.phone ?? ''}
            onChange={(e) => setDraft({ ...draft, signature: { ...draft.signature, phone: e.target.value } })}
          />
        </label>
      </div>
      <label>
        <span className="field-label">Extra line (e.g. scheduling link)</span>
        <input
          value={draft.signature?.extraHtml ?? ''}
          onChange={(e) => setDraft({ ...draft, signature: { ...draft.signature, extraHtml: e.target.value } })}
        />
      </label>

      <button type="button" style={{ marginTop: '1rem' }} disabled={saving} onClick={() => void handleSave()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {status && <p className="status-ok">{status}</p>}
      {error && <p className="dash-page__error">{error}</p>}
    </div>
  );
}
