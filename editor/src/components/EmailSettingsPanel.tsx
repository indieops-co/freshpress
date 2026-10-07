import { useEffect, useState } from 'react';
import { getToken } from '../api';

type EmailProviderId = 'resend' | 'sendgrid' | 'postmark' | 'smtp';

const PROVIDER_OPTIONS: Array<{ id: EmailProviderId; label: string; hint: string }> = [
  { id: 'resend', label: 'Resend (recommended)', hint: 'Enables the built-in site inbox and campaigns.' },
  { id: 'sendgrid', label: 'SendGrid', hint: 'Sends via your SendGrid account (API key).' },
  { id: 'postmark', label: 'Postmark', hint: 'Sends via your Postmark server (server API token).' },
  { id: 'smtp', label: 'SMTP (any email account)', hint: 'Advanced — use any mailbox provider’s SMTP credentials.' },
];

interface EmailSettings {
  enabled: boolean;
  provider?: EmailProviderId;
  fromEmail?: string;
  fromName?: string;
  notifyEmail?: string;
  hasApiKey?: boolean;
  apiKeyPreview?: string;
  smtp?: { host?: string; port?: number; secure?: boolean; username?: string; hasPassword?: boolean };
}

interface FormSubmission {
  id: string;
  name: string;
  email: string;
  message: string;
  pagePath?: string;
  createdAt: string;
}

interface Props {
  siteId: string;
  siteName: string;
  onClose: () => void;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? 'Request failed');
  }
  return res.json();
}

export default function EmailSettingsPanel({ siteId, siteName, onClose }: Props) {
  const [settings, setSettings] = useState<EmailSettings>({ enabled: false });
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [provider, setProvider] = useState<EmailProviderId>('resend');
  const [resendApiKey, setResendApiKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [inviteTo, setInviteTo] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [editorUrl, setEditorUrl] = useState('');
  const [contactSnippet, setContactSnippet] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ settings: EmailSettings; editorUrl: string; contactFormSnippet: string }>(
        `/api/sites/${siteId}/email`
      ),
      apiFetch<FormSubmission[]>(`/api/sites/${siteId}/submissions`),
    ])
      .then(([emailData, subs]) => {
        setSettings(emailData.settings);
        setProvider(emailData.settings.provider ?? 'resend');
        setSmtpHost(emailData.settings.smtp?.host ?? '');
        setSmtpPort(emailData.settings.smtp?.port ? String(emailData.settings.smtp.port) : '');
        setSmtpSecure(!!emailData.settings.smtp?.secure);
        setSmtpUsername(emailData.settings.smtp?.username ?? '');
        setFromEmail(emailData.settings.fromEmail ?? '');
        setFromName(emailData.settings.fromName ?? '');
        setNotifyEmail(emailData.settings.notifyEmail ?? '');
        setEnabled(!!emailData.settings.enabled);
        setEditorUrl(emailData.editorUrl);
        setContactSnippet(emailData.contactFormSnippet);
        setSubmissions(subs);
      })
      .catch((e) => setError(e.message));
  }, [siteId]);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatus('Saving…');
    try {
      const body: Record<string, unknown> = {
        provider,
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim(),
        notifyEmail: notifyEmail.trim(),
        enabled,
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

      const data = await apiFetch<{ settings: EmailSettings }>(`/api/sites/${siteId}/email`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setSettings(data.settings);
      setResendApiKey('');
      setApiKey('');
      setSmtpPassword('');
      setStatus('Settings saved');
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
      await apiFetch(`/api/sites/${siteId}/email/test`, {
        method: 'POST',
        body: JSON.stringify({ to: testTo.trim() }),
      });
      setStatus('Test email sent');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
      setStatus('');
    }
  }

  async function sendInvite() {
    if (!inviteTo.trim()) return;
    setError('');
    setStatus('Sending invite…');
    try {
      await apiFetch(`/api/sites/${siteId}/email/invite`, {
        method: 'POST',
        body: JSON.stringify({ to: inviteTo.trim(), agencyName: agencyName.trim() || undefined }),
      });
      setStatus('Invite sent');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
      setStatus('');
    }
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(contactSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="seo-panel">
      <div className="seo-panel-header">
        <div>
          <h2>Email — {siteName}</h2>
          <p className="hint">
            Connect your own email provider. Branded templates built in.
          </p>
        </div>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      <form onSubmit={saveSettings} className="panel" style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Delivery settings</h3>
        <div className="form-group">
          <label>Email provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as EmailProviderId)}>
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="hint">{PROVIDER_OPTIONS.find((p) => p.id === provider)?.hint}</p>
        </div>
        {provider !== 'resend' && (
          <p className="hint" style={{ marginBottom: '0.75rem' }}>
            The built-in site inbox requires Resend. Other providers cover outbound email only.
          </p>
        )}
        {provider === 'resend' && (
          <div className="form-group">
            <label>
              Resend API key —{' '}
              <a href="https://resend.com" target="_blank" rel="noreferrer">
                get one at resend.com
              </a>
            </label>
            {settings.provider === 'resend' && settings.apiKeyPreview && (
              <p className="hint">Current key: {settings.apiKeyPreview}</p>
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
            {settings.provider === provider && settings.apiKeyPreview && (
              <p className="hint">Current key: {settings.apiKeyPreview}</p>
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
              <input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} placeholder="you@yourdomain.com" />
            </div>
            <div className="form-group">
              <label>Password</label>
              {settings.smtp?.hasPassword && <p className="hint">A password is saved — leave blank to keep it.</p>}
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
          <label>From email (a sender address verified with your provider)</label>
          <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="hello@yourdomain.com" />
        </div>
        <div className="form-group">
          <label>From name</label>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Agency" />
        </div>
        <div className="form-group">
          <label>Notify email (contact form inbox)</label>
          <input value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="you@agency.com" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable email for this site
        </label>
        <button type="submit">Save settings</button>
      </form>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Test & invite</h3>
        <div className="form-group">
          <label>Send test email to</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            <button type="button" className="secondary" onClick={sendTest}>
              Send test
            </button>
          </div>
        </div>
        <div className="form-group">
          <label>Client editor invite</label>
          <input value={inviteTo} onChange={(e) => setInviteTo(e.target.value)} placeholder="client@example.com" />
        </div>
        <div className="form-group">
          <label>Agency name (optional)</label>
          <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Acme Web Studio" />
        </div>
        <button type="button" onClick={sendInvite}>Email client invite</button>
        {editorUrl && (
          <p className="hint" style={{ marginTop: '0.75rem' }}>
            Editor link: {editorUrl}
          </p>
        )}
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Contact form snippet</h3>
          <button type="button" className="secondary" onClick={copySnippet}>
            {copied ? '✓ Copied' : '⎘ Copy HTML'}
          </button>
        </div>
        <pre className="seo-prompt-content" style={{ maxHeight: '160px' }}>
          {contactSnippet || 'Save settings to generate snippet…'}
        </pre>
      </div>

      <div className="panel">
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
          Form submissions ({submissions.length})
        </h3>
        {submissions.length === 0 ? (
          <p className="hint">No submissions yet.</p>
        ) : (
          <ul className="slot-list">
            {submissions.slice(0, 10).map((s) => (
              <li key={s.id} className="slot-item" style={{ cursor: 'default' }}>
                <div>
                  <strong>{s.name}</strong> — {s.email}
                </div>
                <div className="tag">{new Date(s.createdAt).toLocaleString()}</div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{s.message.slice(0, 120)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
