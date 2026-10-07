import { useEffect, useState } from 'react';
import { api, type SiteMeta, type SiteVersion } from '../api';
import SiteEmailDelivery from '../components/SiteEmailDelivery';
import InboundEmailDomainSetup from '../components/InboundEmailDomainSetup';
import ClientAccessInvite from '../components/ClientAccessInvite';
import HumanizerSettingsSection from '../components/HumanizerSettingsSection';
import SocialAccountsSection from '../components/SocialAccountsSection';
import WordPressConnectorCard from '../components/WordPressConnectorCard';
import { useAuth } from '../context/AuthContext';

interface Props {
  siteId: string;
}

interface PublishRow {
  id: string;
  label: string;
  createdAt: string;
  deploymentUrl?: string;
}

export default function SettingsPage({ siteId }: Props) {
  const { role, user } = useAuth();
  const isAdmin = role === 'admin';
  // Mirror the requireOwner guard on the connector token routes: workspace
  // owner/admin only (members have edit-only access; site-password clients excluded).
  const canManageConnector = isAdmin && user?.role !== 'member';
  const [meta, setMeta] = useState<SiteMeta | null>(null);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [publishes, setPublishes] = useState<PublishRow[]>([]);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.getSite(siteId).then((s) => s.meta),
      api.listVersions(siteId),
      api.listPublishes(siteId),
    ])
      .then(([m, v, p]) => {
        setMeta(m);
        setVersions(v);
        setPublishes(p);
      })
      .catch((e) => setError(e.message));
  }, [siteId]);

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setError('');
    setStatus('Saving…');
    try {
      await api.setPassword(siteId, password.trim());
      setPassword('');
      setStatus('Client password updated');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save password');
      setStatus('');
    }
  }

  async function toggleClientCanPublish(next: boolean) {
    setError('');
    try {
      const updated = await api.updateSite(siteId, { clientCanPublish: next });
      setMeta(updated);
      setStatus(next ? 'Client can now publish directly' : 'Client edits now require review');
      setTimeout(() => setStatus(''), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update publishing rights');
    }
  }

  if (error && !meta) return <div className="error-banner">{error}</div>;
  if (!meta) return <p className="dash-page__muted">Loading settings…</p>;

  const latestPublish = publishes[0];
  const latestVersion = versions[0];

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Site Settings</h2>
      <p className="dash-page__muted">Settings for {meta.name} — not workspace admin.</p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      <div className="settings-grid">
        <section className="panel settings-card">
          <h3>Site Identity</h3>
          <dl className="settings-dl">
            <dt>Name</dt>
            <dd>{meta.name}</dd>
            <dt>Live domain</dt>
            <dd>{meta.domain ?? '—'}</dd>
            <dt>Site ID</dt>
            <dd><code>{meta.id}</code></dd>
          </dl>
        </section>

        <section className="panel settings-card">
          <h3>Publishing</h3>
          <dl className="settings-dl">
            <dt>Provider</dt>
            <dd>Vercel / static (configure via publish)</dd>
            <dt>Last publish</dt>
            <dd>{latestPublish ? new Date(latestPublish.createdAt).toLocaleString() : '—'}</dd>
            <dt>Status</dt>
            <dd>{latestPublish?.deploymentUrl ? 'Deployed' : publishes.length ? 'Local snapshot' : 'Not published'}</dd>
            <dt>Target</dt>
            <dd>{latestPublish?.deploymentUrl ?? meta.domain ?? '—'}</dd>
          </dl>
        </section>

        <section className="panel settings-card">
          <h3>Snapshots</h3>
          <dl className="settings-dl">
            <dt>Latest</dt>
            <dd>{latestVersion ? `${latestVersion.label} (${new Date(latestVersion.createdAt).toLocaleString()})` : '—'}</dd>
            <dt>Count</dt>
            <dd>{versions.length}</dd>
            <dt>Rollback</dt>
            <dd>Available via Snapshots section</dd>
          </dl>
        </section>

        <section className="panel settings-card">
          <h3>Metadata</h3>
          <p className="dash-page__muted">Default SEO title, meta description, and OpenGraph image — TODO.</p>
        </section>

        <HumanizerSettingsSection siteId={siteId} />

        {isAdmin && <SocialAccountsSection siteId={siteId} />}

        <section className="panel settings-card settings-card--full">
          <SiteEmailDelivery siteId={siteId} />
        </section>

        {isAdmin && (
          <section className="panel settings-card settings-card--full">
            <InboundEmailDomainSetup siteId={siteId} />
          </section>
        )}

        {canManageConnector && <WordPressConnectorCard siteId={siteId} />}

        <section className="panel settings-card settings-card--full">
          <h3>Access</h3>
          <p className="dash-page__muted">Set a client password for site-scoped editor access.</p>
          <form onSubmit={savePassword} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New client password"
              style={{ flex: '1 1 200px' }}
            />
            <button type="submit">Save password</button>
          </form>

          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={meta.clientCanPublish ?? false}
                onChange={(e) => void toggleClientCanPublish(e.target.checked)}
                style={{ marginTop: '0.2rem' }}
              />
              <span>
                <strong>Let this client publish directly</strong>
                <span className="dash-page__muted" style={{ display: 'block', fontSize: '0.85rem' }}>
                  When off (default), the client&apos;s edits are saved and submitted for your review — they
                  go live only after you approve. When on, the client can publish to the live site themselves.
                </span>
              </span>
            </label>
          </div>

          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <ClientAccessInvite siteId={siteId} />
          </div>
        </section>

        <section className="panel settings-card settings-card--danger">
          <h3>Danger Zone</h3>
          <p className="dash-page__muted">Archive and delete are disabled for now.</p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="secondary" disabled>
              Archive site
            </button>
            <button type="button" className="danger" disabled>
              Delete site
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
