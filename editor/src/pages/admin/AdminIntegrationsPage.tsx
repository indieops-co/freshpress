import { useEffect, useState } from 'react';
import { api } from '../../api';
export default function AdminIntegrationsPage() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.getIntegrations>> | null>(null);
  const [vercelToken, setVercelToken] = useState('');
  const [vercelTeamId, setVercelTeamId] = useState('');
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [onpageKey, setOnpageKey] = useState('');
  const [originalityKey, setOriginalityKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [provisioning, setProvisioning] = useState<{ mode: 'platform' | 'byo'; hasToken: boolean } | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [provisioningTeam, setProvisioningTeam] = useState(false);

  useEffect(() => {
    api.getIntegrations().then(setStatus).catch((e) => setError(e.message));
    api.getVercelProvisioning().then(setProvisioning).catch(() => setProvisioning(null));
  }, []);

  useEffect(() => {
    if (status?.vercelTeamId) setVercelTeamId(status.vercelTeamId);
  }, [status]);

  async function provisionTeam() {
    if (!newTeamName.trim()) {
      setError('Enter a name for the new Vercel team.');
      return;
    }
    setProvisioningTeam(true);
    setError('');
    setMessage('');
    try {
      const team = await api.provisionVercelTeam(newTeamName.trim());
      setVercelTeamId(team.teamId);
      setNewTeamName('');
      setMessage(`Vercel team created (${team.slug}). Team ID saved — client sites will deploy into it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provisioning failed');
    } finally {
      setProvisioningTeam(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const patch: Parameters<typeof api.updateIntegrations>[0] = {
        vercelTeamId: vercelTeamId || null,
      };
      if (vercelToken) patch.vercel_token = vercelToken;
      if (firecrawlKey) patch.firecrawl_api_key = firecrawlKey;
      if (onpageKey) patch.onpage_ai_api_key = onpageKey;
      if (originalityKey) patch.originality_ai_api_key = originalityKey;

      const next = await api.updateIntegrations(patch);
      setStatus(next);
      setVercelToken('');
      setFirecrawlKey('');
      setOnpageKey('');
      setOriginalityKey('');
      setMessage('Integrations saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(key: 'vercel_token' | 'firecrawl_api_key' | 'onpage_ai_api_key' | 'originality_ai_api_key') {
    setSaving(true);
    setError('');
    try {
      const next = await api.updateIntegrations({ [key]: null });
      setStatus(next);
      setMessage('Key removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <p className="dash-page__error">{error}</p>}
      {message && <p className="dash-page__success">{message}</p>}

      <form className="admin-form" onSubmit={save}>
        <fieldset className="admin-form__section">
          <legend>Vercel (publish client sites)</legend>
          <p className="dash-page__muted">
            Status: {status?.vercel ? '✓ configured' : 'not set'}
            {status?.vercel && (
              <button type="button" className="secondary admin-form__clear" onClick={() => clearKey('vercel_token')}>
                Remove
              </button>
            )}
          </p>
          <label>
            Vercel token
            <input
              type="password"
              value={vercelToken}
              onChange={(e) => setVercelToken(e.target.value)}
              placeholder={status?.vercel ? '•••••••• (leave blank to keep)' : 'vercel_...'}
              autoComplete="off"
            />
          </label>
          <label>
            Vercel team ID (optional)
            <input value={vercelTeamId} onChange={(e) => setVercelTeamId(e.target.value)} placeholder="team_..." />
          </label>

          {provisioning?.mode === 'platform' ? (
            <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
              <p className="dash-page__muted">
                Platform mode — provision a dedicated Vercel Team for this workspace. Its ID is saved
                automatically and client sites deploy into it.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="New team name (e.g. Acme Agency)"
                  style={{ flex: '1 1 220px' }}
                />
                <button type="button" onClick={() => void provisionTeam()} disabled={provisioningTeam || !provisioning.hasToken}>
                  {provisioningTeam ? 'Creating…' : 'Provision Vercel team'}
                </button>
              </div>
              {!provisioning.hasToken && (
                <p className="dash-page__muted">Save a Vercel token first, then provision.</p>
              )}
            </div>
          ) : (
            <p className="dash-page__muted">
              Bring-your-own mode — paste your own Vercel team ID above (or leave blank to deploy to your
              account&apos;s default scope).
            </p>
          )}
        </fieldset>

        <fieldset className="admin-form__section">
          <legend>Firecrawl (brand DNA extraction)</legend>
          <p className="dash-page__muted">
            Status: {status?.firecrawl ? '✓ configured' : 'not set'}
            {status?.firecrawl && (
              <button type="button" className="secondary admin-form__clear" onClick={() => clearKey('firecrawl_api_key')}>
                Remove
              </button>
            )}
          </p>
          <label>
            Firecrawl API key
            <input
              type="password"
              value={firecrawlKey}
              onChange={(e) => setFirecrawlKey(e.target.value)}
              placeholder={status?.firecrawl ? '••••••••' : 'fc-...'}
              autoComplete="off"
            />
          </label>
        </fieldset>

        <fieldset className="admin-form__section">
          <legend>On-Page.ai (SERP SEO data)</legend>
          <p className="dash-page__muted">
            Status: {status?.onpage_ai ? '✓ configured' : 'not set'}
            {status?.onpage_ai && (
              <button type="button" className="secondary admin-form__clear" onClick={() => clearKey('onpage_ai_api_key')}>
                Remove
              </button>
            )}
          </p>
          <label>
            On-Page.ai API key
            <input
              type="password"
              value={onpageKey}
              onChange={(e) => setOnpageKey(e.target.value)}
              placeholder={status?.onpage_ai ? '••••••••' : 'API key'}
              autoComplete="off"
            />
          </label>
        </fieldset>

        <fieldset className="admin-form__section">
          <legend>Originality.ai (AI detection)</legend>
          <p className="dash-page__muted">
            Status: {status?.originality_ai ? '✓ configured' : 'not set'}
            {status?.originality_ai && (
              <button
                type="button"
                className="secondary admin-form__clear"
                onClick={() => clearKey('originality_ai_api_key')}
              >
                Remove
              </button>
            )}
          </p>
          <label>
            Originality.ai API key
            <input
              type="password"
              value={originalityKey}
              onChange={(e) => setOriginalityKey(e.target.value)}
              placeholder={status?.originality_ai ? '••••••••' : 'API key'}
              autoComplete="off"
            />
          </label>
        </fieldset>

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save integrations'}
        </button>
      </form>
    </>
  );
}
