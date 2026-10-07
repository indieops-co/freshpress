import { useEffect, useState } from 'react';
import { api, type ConnectorTokenStatus } from '../api';
import UpgradeNotice from './UpgradeNotice';
import { useAuth } from '../context/AuthContext';
import { guideUrl } from '../docsLinks';

interface Props {
  siteId: string;
}

// End-user "Connect your site to WordPress" guide.
const SETUP_GUIDE_URL = guideUrl('connect-wordpress', 'docs/CONNECT-WORDPRESS.md');

/**
 * WordPress Connector card (Site Settings). Owner/admin only — the parent gates
 * rendering, mirroring the requireOwner guard on the token routes. Shows masked
 * status (never the token), issues/rotates a token shown EXACTLY once in a modal,
 * and revokes with a confirm.
 */
export default function WordPressConnectorCard({ siteId }: Props) {
  const auth = useAuth();
  const [status, setStatus] = useState<ConnectorTokenStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  // The plaintext token, held only long enough to show it once, then dropped.
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .getConnectorToken(siteId)
      .then((s) => live && setStatus(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Failed to load connector status'));
    return () => {
      live = false;
    };
  }, [siteId]);

  // Tier gate mirrors the server: only ISSUING a token is paid (the status route
  // stays open), so a downgraded workspace sees the upgrade card, not a broken one.
  if (!(auth.features?.wordpressConnector ?? true)) {
    return (
      <UpgradeNotice title="WordPress Connector">
        Push published FreshPress content into any WordPress site with a one-token plugin
        connection — no copy-paste, no FTP.
      </UpgradeNotice>
    );
  }

  async function refresh() {
    try {
      setStatus(await api.getConnectorToken(siteId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load connector status');
    }
  }

  async function issue(isRotate: boolean) {
    if (isRotate && !window.confirm('Rotate the connector token? The current token stops working immediately — the WordPress plugin will need the new one pasted in to keep syncing.')) {
      return;
    }
    setError('');
    setNotice('');
    setWorking(true);
    try {
      const { token } = await api.issueConnectorToken(siteId);
      setIssuedToken(token);
      setCopied(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to issue token');
    } finally {
      setWorking(false);
    }
  }

  async function revoke() {
    if (!window.confirm('Revoke the connector token? The WordPress plugin will stop syncing until a new token is issued and pasted in.')) {
      return;
    }
    setError('');
    setNotice('');
    setWorking(true);
    try {
      await api.revokeConnectorToken(siteId);
      setNotice('Connector token revoked — WordPress is now disconnected.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke token');
    } finally {
      setWorking(false);
    }
  }

  async function copyToken() {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard — select and copy the token manually.');
    }
  }

  function closeModal() {
    setIssuedToken(null);
    setNotice('Token issued — paste it into the WordPress plugin now; it will not be shown again.');
  }

  const connected = status?.connected ?? false;
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : null);

  return (
    <section className="panel settings-card settings-card--full" id="wordpress-connector">
      <h3>WordPress Connector</h3>
      <p className="dash-page__muted">
        Publish this site into a WordPress install with the FreshPress Connector plugin. Issue a
        connector token here, then paste it into Settings → FreshPress in WordPress. FreshPress stays
        the source of truth — the plugin only pulls published content.
      </p>

      <details className="dash-page__muted" style={{ marginTop: '0.5rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How this works — setup steps</summary>
        <ol style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', lineHeight: 1.6 }}>
          <li>
            <strong>Publish your pages in FreshPress.</strong> Only published content
            syncs — drafts never leave FreshPress.
          </li>
          <li>
            <strong>Install the FreshPress Connector plugin on your WordPress site</strong>{' '}
            (WP Admin → Plugins → Add New → Upload Plugin). Works on any WordPress,
            including cloud hosts.
          </li>
          <li>
            <strong>Issue a connector token below</strong>, then paste it — with your
            app&apos;s public URL — into <em>Settings → FreshPress</em> in WordPress.
          </li>
          <li>
            In WordPress, click <strong>Test connection</strong>, then{' '}
            <strong>Sync now</strong>. Your published pages appear in WordPress.
          </li>
        </ol>
        <p style={{ margin: '0.25rem 0 0' }}>
          Optional pre-flight: test the plugin on a throwaway local WordPress before a
          client&apos;s live site.{' '}
          <a href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
            Full setup guide ↗
          </a>
        </p>
      </details>

      {error && <p className="dash-page__error">{error}</p>}
      {notice && <p className="status-ok">{notice}</p>}

      {status === null && !error ? (
        <p className="dash-page__muted">Loading connector status…</p>
      ) : (
        <dl className="settings-dl" style={{ marginTop: '0.5rem' }}>
          <dt>Status</dt>
          <dd>{connected ? '🟢 Connected — a token is active' : '⚪ Not connected'}</dd>
          {connected && (
            <>
              <dt>Token issued</dt>
              <dd>{fmt(status?.createdAt) ?? '—'}</dd>
              <dt>Last plugin pull</dt>
              <dd>{fmt(status?.lastUsedAt) ?? 'never (plugin has not synced yet)'}</dd>
              {status?.lastReport && (
                <>
                  <dt>WordPress last sync</dt>
                  <dd>
                    {fmt(status.lastReport.receivedAt) ?? '—'} — {status.lastReport.created} created /{' '}
                    {status.lastReport.updated} updated / {status.lastReport.skipped} skipped /{' '}
                    {status.lastReport.errors} errors
                    {status.lastReport.error ? ` — ${status.lastReport.error}` : ''}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
      )}

      {status?.drift?.behind && (
        <p className="dash-page__error" style={{ marginTop: '0.5rem' }}>
          ⚠️ WordPress copy is behind — last pulled {fmt(status.drift.lastPulledAt) ?? 'never'}. Run a sync
          in WordPress (or wait for the twice-daily cron) to pull the latest publish.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        {connected ? (
          <>
            <button type="button" onClick={() => void issue(true)} disabled={working}>
              {working ? 'Working…' : 'Rotate token'}
            </button>
            <button type="button" className="danger" onClick={() => void revoke()} disabled={working}>
              Revoke token
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void issue(false)} disabled={working || status === null}>
            {working ? 'Working…' : 'Issue connector token'}
          </button>
        )}
      </div>

      {issuedToken && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New connector token"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={closeModal}
        >
          <div
            className="panel"
            style={{ maxWidth: '520px', width: '100%', padding: '1.5rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Your connector token</h3>
            <p className="dash-page__error" style={{ fontWeight: 600 }}>
              Copy this now — you won&apos;t be able to see it again. Anyone with this token can pull
              your published content, so keep it secret.
            </p>
            <code
              style={{
                display: 'block',
                wordBreak: 'break-all',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--surface, #f6f8fa)',
                fontSize: '0.9rem',
                margin: '0.75rem 0',
              }}
            >
              {issuedToken}
            </code>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => void copyToken()}>
                {copied ? '✓ Copied' : '⎘ Copy token'}
              </button>
              <button type="button" className="secondary" onClick={closeModal}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
