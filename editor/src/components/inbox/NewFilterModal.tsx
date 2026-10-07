import { useState } from 'react';
import { api, type EmailFolder, type EmailFolderFilterMatchType } from '../../api';

interface Props {
  siteId: string;
  folder: EmailFolder;
  onClose: () => void;
  onSaved: () => void;
}

export default function NewFilterModal({ siteId, folder, onClose, onSaved }: Props) {
  const [matchType, setMatchType] = useState<EmailFolderFilterMatchType>(folder.filterRule?.matchType ?? 'keyword');
  const [value, setValue] = useState(folder.filterRule?.value ?? '');
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.updateInboxFolder(siteId, folder.id, { filterRule: { matchType, value: value.trim() } });
      if (applyToExisting) {
        await api.applyInboxFolderFilter(siteId, folder.id);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save filter');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api.updateInboxFolder(siteId, folder.id, { filterRule: null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove filter');
      setSaving(false);
    }
  }

  return (
    <div className="seo-modal-backdrop" onClick={onClose}>
      <div className="seo-modal" style={{ width: 'min(420px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Filter into "{folder.name}"</h3>
        <p className="dash-page__muted">
          Incoming mail matching this rule skips the Inbox and lands here instead.
        </p>
        {error && <div className="error-banner">{error}</div>}

        <div className="form-group">
          <label>Match</label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <label style={{ fontWeight: 'normal' }}>
              <input type="radio" checked={matchType === 'keyword'} onChange={() => setMatchType('keyword')} />{' '}
              Subject keyword
            </label>
            <label style={{ fontWeight: 'normal' }}>
              <input
                type="radio"
                checked={matchType === 'senderDomain'}
                onChange={() => setMatchType('senderDomain')}
              />{' '}
              Sender domain
            </label>
          </div>
        </div>

        <div className="form-group">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={matchType === 'keyword' ? 'e.g. invoice' : 'e.g. clientdomain.com'}
          />
        </div>

        <label className="humanize-panel__review-opt">
          <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} />
          Also move existing matching Inbox emails here
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'space-between' }}>
          <div>
            {folder.filterRule && (
              <button type="button" className="danger" disabled={saving} onClick={() => void remove()}>
                Remove filter
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={saving || !value.trim()} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save filter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
