import { useState } from 'react';
import { api, type EmailProviderId, type SiteEmailSettings } from '../api';
import { guideUrl } from '../docsLinks';
import { buildWizardSave, hasSavedApiKey, rememberMailboxesOnly } from './emailSetup';

// End-user email guide.
const EMAIL_GUIDE_URL = guideUrl('email', 'docs/EMAIL.md');

interface Props {
  siteId: string;
  /** The site's saved settings, if loaded — prefills the wizard so a re-run doesn't overwrite them. */
  saved?: SiteEmailSettings;
  /** Called after the wizard finishes (settings saved) or the user exits it. */
  onDone: () => void;
}

type Step = 'goal' | 'provider' | 'connect' | 'test';

const PROVIDER_CARDS: Array<{ id: EmailProviderId; label: string; hint: string }> = [
  {
    id: 'resend',
    label: 'Resend (recommended)',
    hint: 'Free tier covers most sites. The only provider that also powers the built-in site inbox.',
  },
  { id: 'sendgrid', label: 'SendGrid', hint: 'Use an existing SendGrid account (API key). Outbound email only.' },
  { id: 'postmark', label: 'Postmark', hint: 'Use an existing Postmark server (API token). Outbound email only.' },
  {
    id: 'smtp',
    label: 'SMTP — any email account',
    hint: 'Advanced: send through any mailbox provider (Google Workspace, Zoho, …) via SMTP credentials.',
  },
];

/**
 * Guided "Set up email" flow: goal → provider → connect → test. Wraps the same
 * PUT /email + test endpoints as the manual form; it never handles secrets
 * differently — just sequences them.
 */
export default function EmailSetupWizard({ siteId, saved, onDone }: Props) {
  const [step, setStep] = useState<Step>('goal');
  // Tracks what the server holds, so going Back after a save doesn't re-demand the key.
  const [current, setCurrent] = useState(saved);
  const [provider, setProvider] = useState<EmailProviderId>(saved?.provider ?? 'resend');
  const [resendApiKey, setResendApiKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [smtpHost, setSmtpHost] = useState(saved?.smtp?.host ?? '');
  const [smtpPort, setSmtpPort] = useState(saved?.smtp?.port ? String(saved.smtp.port) : '');
  const [smtpSecure, setSmtpSecure] = useState(!!saved?.smtp?.secure);
  const [smtpUsername, setSmtpUsername] = useState(saved?.smtp?.username ?? '');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [fromEmail, setFromEmail] = useState(saved?.fromEmail ?? '');
  const [fromName, setFromName] = useState(saved?.fromName ?? '');
  const [notifyEmail, setNotifyEmail] = useState(saved?.notifyEmail ?? '');
  const [turnOn, setTurnOn] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const stepNumber = { goal: 1, provider: 2, connect: 3, test: 4 }[step];
  const keySaved = hasSavedApiKey(provider, current);

  async function saveAndContinue(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = buildWizardSave(
      {
        provider,
        resendApiKey,
        apiKey,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUsername,
        smtpPassword,
        fromEmail,
        fromName,
        notifyEmail,
        turnOn,
      },
      current
    );
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setStatus('Saving…');
    try {
      const data = await api.updateEmailSettings(siteId, result.body);
      setCurrent(data.settings);
      setResendApiKey('');
      setApiKey('');
      setSmtpPassword('');
      setStatus('');
      setTestTo(notifyEmail.trim() || fromEmail.trim());
      setStep('test');
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
      setStatus('Test email sent — check that inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
      setStatus('');
    }
  }

  return (
    <div className="panel" style={{ marginTop: '0.75rem' }}>
      <p className="hint" style={{ marginBottom: '0.75rem' }}>
        Email setup — step {stepNumber} of 4
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      {step === 'goal' && (
        <>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>What do you need email for?</h3>
          <div className="panel" style={{ marginBottom: '0.75rem' }}>
            <strong>Email for your site</strong>
            <p className="hint" style={{ margin: '0.25rem 0 0.75rem' }}>
              Contact-form notifications, newsletter signups, campaigns, and an inbox for addresses like
              hello@yourdomain.com — built into FreshPress, powered by a free provider account you own.
            </p>
            <button type="button" onClick={() => setStep('provider')}>
              Set up site email
            </button>
          </div>
          <div className="panel">
            <strong>Business mailboxes (Gmail-style, on your phone)</strong>
            <p className="hint" style={{ margin: '0.25rem 0 0.75rem' }}>
              For personal work email in Apple Mail or the Gmail app, use Google Workspace or Zoho Mail on your
              domain — the same answer premium WordPress hosts give. It coexists with FreshPress site email:
              your mailboxes keep the main domain, and the site inbox uses a subdomain like mail.yourdomain.com.{' '}
              <a href={EMAIL_GUIDE_URL} target="_blank" rel="noreferrer">
                Read the email guide
              </a>
              .
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                rememberMailboxesOnly(siteId);
                onDone();
              }}
            >
              I only need mailboxes — done
            </button>
          </div>
        </>
      )}

      {step === 'provider' && (
        <>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Pick your email provider</h3>
          {PROVIDER_CARDS.map((p) => (
            <label
              key={p.id}
              className="panel"
              style={{ display: 'block', marginBottom: '0.5rem', cursor: 'pointer' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="radio"
                  name="wizard-provider"
                  checked={provider === p.id}
                  onChange={() => setProvider(p.id)}
                />
                <strong>{p.label}</strong>
              </span>
              <span className="hint" style={{ display: 'block', marginTop: '0.25rem' }}>
                {p.hint}
              </span>
            </label>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="secondary" onClick={() => setStep('goal')}>
              Back
            </button>
            <button type="button" onClick={() => setStep('connect')}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 'connect' && (
        <form onSubmit={saveAndContinue}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Connect {PROVIDER_CARDS.find((p) => p.id === provider)?.label.replace(' (recommended)', '')}
          </h3>
          {provider === 'resend' && (
            <div className="form-group">
              <label>
                Resend API key —{' '}
                <a href="https://resend.com" target="_blank" rel="noreferrer">
                  create a free account
                </a>{' '}
                and verify your domain there first
              </label>
              {keySaved && <p className="hint">A key is already saved — leave blank to keep it.</p>}
              <input
                type="password"
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                placeholder="re_…"
              />
            </div>
          )}
          {(provider === 'sendgrid' || provider === 'postmark') && (
            <div className="form-group">
              <label>{provider === 'sendgrid' ? 'SendGrid API key' : 'Postmark server API token'}</label>
              {keySaved && <p className="hint">A key is already saved — leave blank to keep it.</p>}
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
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
                {current?.smtp?.hasPassword && <p className="hint">A password is saved — leave blank to keep it.</p>}
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
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Business" />
          </div>
          <div className="form-group">
            <label>Where should contact-form messages go? (defaults to the from email)</label>
            <input value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="you@yourdomain.com" />
          </div>
          {current?.hasApiKey && !current.enabled && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" checked={turnOn} onChange={(e) => setTurnOn(e.target.checked)} />
              Turn email on for this site (it is currently off, so nothing sends)
            </label>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="secondary" onClick={() => setStep('provider')}>
              Back
            </button>
            <button type="submit">Save &amp; continue</button>
          </div>
        </form>
      )}

      {step === 'test' && (
        <>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Send a test email</h3>
          {current?.enabled ? (
            <>
              <p className="hint">Email is saved and enabled. Confirm delivery works before you rely on it.</p>
              <div className="form-group">
                <label>Send test to</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
                  <button type="button" className="secondary" onClick={sendTest}>
                    Send test
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="hint">
              Settings saved, but email is still turned off for this site, so nothing (including a test) can send.
              Go Back and tick “Turn email on”, or turn it on later under Forms.
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="secondary" onClick={() => setStep('connect')}>
              Back
            </button>
            <button type="button" onClick={onDone}>
              Finish
            </button>
          </div>
        </>
      )}
    </div>
  );
}
