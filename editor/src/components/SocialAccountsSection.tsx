import { useEffect, useState } from 'react';
import { api, type SocialAccount, type SocialPlatform, type SocialSiteConfig } from '../api';

const PLATFORMS: { value: SocialPlatform; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
];

interface Props {
  siteId: string;
}

export default function SocialAccountsSection({ siteId }: Props) {
  const [config, setConfig] = useState<SocialSiteConfig | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.getSocialConfig(siteId).then(setConfig).catch((e) => setError(e.message));
  }, [siteId]);

  async function save(next: SocialSiteConfig) {
    setError('');
    try {
      const saved = await api.updateSocialConfig(siteId, next);
      setConfig(saved);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  function addAccount() {
    if (!config) return;
    const account: SocialAccount = {
      id: `acc_${Date.now()}`,
      platform: 'linkedin',
      label: '',
      included: true,
    };
    void save({ ...config, accounts: [...config.accounts, account] });
  }

  function updateAccount(id: string, patch: Partial<SocialAccount>) {
    if (!config) return;
    void save({
      ...config,
      accounts: config.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  }

  function removeAccount(id: string) {
    if (!config) return;
    void save({ ...config, accounts: config.accounts.filter((a) => a.id !== id) });
  }

  if (!config) return <p className="dash-page__muted">Loading social settings…</p>;

  return (
    <section className="panel settings-card settings-card--full" id="social-accounts">
      <h3>Social Accounts</h3>
      <p className="dash-page__muted">
        Per-site brand handles for the social content pipeline. Copy-paste workflow — no OAuth in MVP.
      </p>
      {error && <p className="dash-page__error">{error}</p>}
      {status && <p className="status-ok">{status}</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1rem 0' }}>
        <input
          type="checkbox"
          checked={config.autoGenerateOnPublish}
          onChange={(e) => void save({ ...config, autoGenerateOnPublish: e.target.checked })}
        />
        Auto-generate social drafts when a blog post is published
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="checkbox"
          checked={config.defaultFullScreenCards}
          onChange={(e) => void save({ ...config, defaultFullScreenCards: e.target.checked })}
        />
        Default: include full-screen text cards (light + dark)
      </label>

      {config.accounts.map((account) => (
        <div
          key={account.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr auto auto',
            gap: '0.5rem',
            alignItems: 'center',
            marginBottom: '0.75rem',
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
          }}
        >
          <select
            value={account.platform}
            onChange={(e) => updateAccount(account.id, { platform: e.target.value as SocialPlatform })}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            value={account.label}
            onChange={(e) => updateAccount(account.id, { label: e.target.value })}
            placeholder="@handle or Brand Page"
          />
          <input
            value={account.profileUrl ?? ''}
            onChange={(e) => updateAccount(account.id, { profileUrl: e.target.value || undefined })}
            placeholder="Profile URL (optional)"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={account.included}
              onChange={(e) => updateAccount(account.id, { included: e.target.checked })}
            />
            Include
          </label>
          <button type="button" className="secondary" onClick={() => removeAccount(account.id)}>
            Remove
          </button>
        </div>
      ))}

      <button type="button" onClick={addAccount}>
        Add account
      </button>
    </section>
  );
}
