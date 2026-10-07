import { useCallback, useEffect, useState } from 'react';
import { api, type EmailProviderId, type SiteEmailSettings } from '../api';
import EmailSetupWizard from './EmailSetupWizard';
import { choseMailboxesOnly } from './emailSetup';

interface Props {
  siteId: string;
}

const PROVIDER_OPTIONS: Array<{ id: EmailProviderId; label: string }> = [
  { id: 'resend', label: 'Resend (recommended)' },
  { id: 'sendgrid', label: 'SendGrid' },
  { id: 'postmark', label: 'Postmark' },
  { id: 'smtp', label: 'SMTP (any email account)' },
];

export default function SiteEmailDelivery({ siteId }: Props) {
  const [provider, setProvider] = useState<EmailProviderId>('resend');
  const [savedProvider, setSavedProvider] = useState<EmailProviderId>('resend');
  const [resendApiKey, setResendApiKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [hasSmtpPassword, setHasSmtpPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [apiKeyPreview, setApiKeyPreview] = useState<string | undefined>();
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  // Last settings the server returned — prefills the wizard so a re-run doesn't clobber them.
  const [savedSettings, setSavedSettings] = useState<SiteEmailSettings | undefined>();

  const loadSettings = useCallback(
    (openWizardWhenUnconfigured: boolean) =>
      api
        .getEmailSettings(siteId)
        .then((data) => {
          setSavedSettings(data.settings);
          setProvider(data.settings.provider ?? 'resend');
          setSavedProvider(data.settings.provider ?? 'resend');
          setSmtpHost(data.settings.smtp?.host ?? '');
          setSmtpPort(data.settings.smtp?.port ? String(data.settings.smtp.port) : '');
          setSmtpSecure(!!data.settings.smtp?.secure);
          setSmtpUsername(data.settings.smtp?.username ?? '');
          setHasSmtpPassword(!!data.settings.smtp?.hasPassword);
          setFromEmail(data.settings.fromEmail ?? '');
          setFromName(data.settings.fromName ?? '');
          setApiKeyPreview(data.settings.apiKeyPreview);
          if (openWizardWhenUnconfigured) setShowWizard(!data.settings.hasApiKey && !choseMailboxesOnly(siteId));
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoaded(true)),
    [siteId]
  );

  useEffect(() => {
    setLoaded(false);
    setSavedSettings(undefined);
    // First visit with nothing configured lands in the guided wizard, not the raw form —
    // unless the owner already answered "I only need mailboxes" in this browser.
    void loadSettings(true);
  }, [loadSettings]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatus('Saving…');
    try {
      const body: Parameters<typeof api.updateEmailSettings>[1] = {
        provider,
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim(),
      };
      if (provider === 'resend' && resendApiKey.trim()) body.resendApiKey = resendApiKey.trim();
      if ((provider === 'sendgrid' || provider === 'postmark') && apiKey.trim()) body.apiKey = apiKey.trim();
      if (provider === 'smtp') {
        body.smtp = {
          host: smtpHost.trim(),
          ...(smtpPort.trim() ? { port: Number(smtpPort.trim()) } : {}),
          secure: smtpSecure,
          username: smtpUsername.trim(),
          ...(smtpPassword.trim() ? { password: smtpPassword } : {}),
        };
      }

      const data = await api.updateEmailSettings(siteId, body);
      setSavedSettings(data.settings);
      setSavedProvider(provider);
      setApiKeyPreview(data.settings.hasApiKey ? '••••••••' : undefined);
      setResendApiKey('');
      setApiKey('');
      setSmtpPassword('');
      if (provider === 'smtp' && smtpPassword.trim()) setHasSmtpPassword(true);
      setStatus('Email delivery settings saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setError('');
    setStatus('Sending test…');
    try {
      await api.sendTestEmail(siteId, testTo.trim());
      setStatus('Test email sent');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
      setStatus('');
    }
  }

  if (!loaded) {
    return (
      <div>
        <h3>Email delivery</h3>
        <p className="dash-page__muted">Loading…</p>
      </div>
    );
  }

  if (showWizard) {
    return (
      <div>
        <h3>Email delivery</h3>
        {error && <div className="error-banner">{error}</div>}
        <EmailSetupWizard
          siteId={siteId}
          saved={savedSettings}
          onDone={() => {
            setShowWizard(false);
            void loadSettings(false);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <h3>Email delivery</h3>
      <p className="dash-page__muted">
        Per-site delivery via your own provider account (BYOK). Form behavior is managed in <strong>Forms</strong>.{' '}
        <button type="button" className="link-button" onClick={() => setShowWizard(true)}>
          Run setup wizard
        </button>
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      <form onSubmit={save} style={{ marginTop: '0.75rem' }}>
        <div className="form-group">
          <label>Email provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as EmailProviderId)}>
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {provider !== 'resend' && (
          <p className="hint" style={{ marginBottom: '0.75rem' }}>
            The built-in site inbox requires Resend. Other providers cover outbound email only.
          </p>
        )}
        {provider === 'resend' && (
          <div className="form-group">
            <label>Resend API key</label>
            {savedProvider === 'resend' && apiKeyPreview && (
              <p className="hint">Current API key: {apiKeyPreview}</p>
            )}
            <input
              type="password"
              value={resendApiKey}
              onChange={(e) => setResendApiKey(e.target.value)}
              placeholder="re_… (leave blank to keep existing)"
            />
          </div>
        )}
        {(provider === 'sendgrid' || provider === 'postmark') && (
          <div className="form-group">
            <label>{provider === 'sendgrid' ? 'SendGrid API key' : 'Postmark server API token'}</label>
            {savedProvider === provider && apiKeyPreview && (
              <p className="hint">Current API key: {apiKeyPreview}</p>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Leave blank to keep existing"
            />
          </div>
        )}
        {provider === 'smtp' && (
          <>
            <div className="form-group">
              <label>SMTP host</label>
              <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.yourprovider.com" />
            </div>
            <div className="form-group">
              <label>Port</label>
              <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" inputMode="numeric" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              Use TLS from connection start (port 465)
            </label>
            <div className="form-group">
              <label>Username</label>
              <input
                value={smtpUsername}
                onChange={(e) => setSmtpUsername(e.target.value)}
                placeholder="you@yourdomain.com"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              {hasSmtpPassword && <p className="hint">A password is saved — leave blank to keep it.</p>}
              <input
                type="password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                placeholder="App password or SMTP password"
              />
            </div>
          </>
        )}
        <div className="form-group">
          <label>From email (verified with your provider)</label>
          <input
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="hello@yourdomain.com"
          />
        </div>
        <div className="form-group">
          <label>From name</label>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Agency" />
        </div>
        <button type="submit">Save delivery settings</button>
      </form>

      <div style={{ marginTop: '1rem' }}>
        <div className="form-group">
          <label>Send test email to</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            <button type="button" className="secondary" onClick={sendTest}>
              Send test
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
