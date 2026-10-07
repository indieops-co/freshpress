import { useEffect, useState } from 'react';
import { api, type InboundEmailConfig, type InboundDomainRecord } from '../api';

interface Props {
  siteId: string;
}

export default function InboundEmailDomainSetup({ siteId }: Props) {
  const [config, setConfig] = useState<InboundEmailConfig | null>(null);
  const [records, setRecords] = useState<InboundDomainRecord[]>([]);
  const [domainChoice, setDomainChoice] = useState<'root' | 'subdomain'>('subdomain');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getInboundDomainConfig(siteId)
      .then((res) => {
        setConfig(res.config);
        setRecords(res.records);
        if (res.config?.domainChoice) setDomainChoice(res.config.domainChoice);
        if (res.config?.domain) setDomain(res.config.domain);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [siteId]);

  async function setup(e: React.FormEvent) {
    e.preventDefault();
    if (!domain.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.setupInboundDomain(siteId, { domainChoice, domain: domain.trim() });
      setConfig(res.config);
      setRecords(res.records);
      setStatus('Domain registered — add the records below at your registrar, then verify.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setError('');
    try {
      const res = await api.verifyInboundDomain(siteId);
      setConfig(res.config);
      setRecords(res.records);
      setStatus(res.config.verified ? 'Domain verified!' : 'Not verified yet — DNS can take a while to propagate.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification check failed');
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <p className="dash-page__muted">Loading…</p>;

  return (
    <div>
      <h3>Inbound email (webmail)</h3>
      <p className="dash-page__muted">
        Receive mail into this site's Inbox. Choose your root domain or a dedicated subdomain (e.g.{' '}
        <code>mail.clientdomain.com</code>) — either works, this is your choice.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      {config?.domain && (
        <p className="hint" style={{ marginBottom: '0.75rem' }}>
          Current: <strong>{config.domain}</strong> — {config.verified ? 'Verified ✓' : 'Not verified yet'}
        </p>
      )}

      <form onSubmit={setup} style={{ marginTop: '0.75rem' }}>
        <div className="form-group">
          <label>Domain type</label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <label style={{ fontWeight: 'normal' }}>
              <input
                type="radio"
                checked={domainChoice === 'subdomain'}
                onChange={() => setDomainChoice('subdomain')}
              />{' '}
              Dedicated subdomain
            </label>
            <label style={{ fontWeight: 'normal' }}>
              <input type="radio" checked={domainChoice === 'root'} onChange={() => setDomainChoice('root')} /> Root
              domain
            </label>
          </div>
        </div>
        <div className="form-group">
          <label>Domain</label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={domainChoice === 'subdomain' ? 'mail.clientdomain.com' : 'clientdomain.com'}
          />
        </div>
        <button type="submit" disabled={saving}>
          {saving ? 'Registering…' : config?.domain ? 'Update domain' : 'Register domain'}
        </button>
      </form>

      {records.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p className="hint">Add these records at your DNS registrar:</p>
          <table className="settings-dl" style={{ width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Type</th>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th style={{ textAlign: 'left' }}>Value</th>
                <th style={{ textAlign: 'left' }}>Priority</th>
                <th style={{ textAlign: 'left' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i}>
                  <td>{r.type}</td>
                  <td><code>{r.name}</code></td>
                  <td><code>{r.value}</code></td>
                  <td>{r.priority ?? '—'}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="secondary" style={{ marginTop: '0.75rem' }} disabled={verifying} onClick={verify}>
            {verifying ? 'Checking…' : 'Check verification'}
          </button>
        </div>
      )}
    </div>
  );
}
