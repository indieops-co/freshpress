import { useEffect, useState } from 'react';
import { api } from '../api';
import { useDashboard } from '../context/DashboardContext';
import SignupsPanel from '../components/SignupsPanel';

interface Props {
  siteId: string;
  siteName: string;
}

interface Submission {
  id: string;
  name: string;
  email: string;
  message: string;
  pagePath?: string;
  createdAt: string;
}

function deliveryStatus(settings: {
  enabled: boolean;
  hasApiKey?: boolean;
  notifyEmail?: string;
}): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!settings.enabled) return { label: 'Disabled', tone: 'muted' };
  if (!settings.hasApiKey) return { label: 'Needs email provider', tone: 'warn' };
  if (!settings.notifyEmail?.trim()) return { label: 'Needs notification email', tone: 'warn' };
  return { label: 'Active', tone: 'ok' };
}

export default function FormsPage({ siteId, siteName }: Props) {
  const { setActiveSiteSection } = useDashboard();
  const [notifyEmail, setNotifyEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [contactSnippet, setContactSnippet] = useState('');
  const [signupSnippet, setSignupSnippet] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  function loadData() {
    return Promise.all([api.getEmailSettings(siteId), api.listSubmissions(siteId)])
      .then(([emailData, subs]) => {
        setNotifyEmail(emailData.settings.notifyEmail ?? '');
        setSuccessMessage(emailData.settings.successMessage ?? '');
        setEnabled(!!emailData.settings.enabled);
        setHasApiKey(!!emailData.settings.hasApiKey);
        setContactSnippet(emailData.contactFormSnippet);
        setSignupSnippet(emailData.signupFormSnippet ?? '');
        setSubmissions(subs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [siteId]);

  async function saveFormSettings(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatus('Saving…');
    try {
      await api.updateEmailSettings(siteId, {
        notifyEmail: notifyEmail.trim(),
        successMessage: successMessage.trim(),
        enabled,
      });
      setStatus('Form settings saved');
      setTimeout(() => setStatus(''), 2000);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
    }
  }

  async function copySnippet() {
    if (!contactSnippet) return;
    await navigator.clipboard.writeText(contactSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <p className="dash-page__muted">Loading forms…</p>;

  const statusInfo = deliveryStatus({ enabled, hasApiKey, notifyEmail });

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">FreshPress Forms</h2>
      <p className="dash-page__lead">
        FreshPress Forms gives each client site a working contact form and lead inbox — no WordPress plugin, no
        SMTP headache.
      </p>
      <p className="dash-page__muted">
        One contact form per site. Configure email delivery in{' '}
        <button type="button" className="link-button" onClick={() => setActiveSiteSection('settings')}>
          Site Settings → Email
        </button>
        .
      </p>

      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      <div className="panel forms-status-card">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Contact form — {siteName}</h3>
        <dl className="settings-dl">
          <dt>Status</dt>
          <dd>
            <span className={`forms-status forms-status--${statusInfo.tone}`}>{statusInfo.label}</span>
          </dd>
          <dt>Notification email</dt>
          <dd>{notifyEmail || '—'}</dd>
          <dt>Email delivery</dt>
          <dd>{hasApiKey ? 'Provider connected' : 'Not configured'}</dd>
          <dt>Submissions</dt>
          <dd>{submissions.length}</dd>
        </dl>
      </div>

      <form onSubmit={saveFormSettings} className="panel" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Form behavior</h3>
        <div className="form-group">
          <label>Notification recipient email</label>
          <input
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            placeholder="you@agency.com"
            type="email"
          />
        </div>
        <div className="form-group">
          <label>Success message</label>
          <textarea
            value={successMessage}
            onChange={(e) => setSuccessMessage(e.target.value)}
            placeholder="Thanks! We received your message."
            rows={2}
          />
          <p className="hint">Plain text only. Stored for future use; public form returns a generic success for now.</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Form enabled
        </label>
        <button type="submit">Save form settings</button>
      </form>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Embed snippet</h3>
          <button type="button" className="secondary" onClick={copySnippet} disabled={!contactSnippet}>
            {copied ? '✓ Copied' : '⎘ Copy HTML'}
          </button>
        </div>
        <pre className="seo-prompt-content" style={{ maxHeight: '160px' }}>
          {contactSnippet || 'Configure email delivery in Site Settings → Email to generate a snippet.'}
        </pre>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Submissions inbox ({submissions.length})</h3>
        {submissions.length === 0 ? (
          <p className="hint">No submissions yet.</p>
        ) : (
          <ul className="slot-list">
            {submissions.map((s) => (
              <li
                key={s.id}
                className="slot-item"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedSubmission(s)}
              >
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

      <SignupsPanel siteId={siteId} signupSnippet={signupSnippet} />

      <div className="panel forms-future" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Additional forms</h3>
        <p className="dash-page__muted" style={{ margin: 0 }}>
          Multi-form builder, custom fields, file uploads, and conditional logic — coming later.
        </p>
        <button type="button" className="secondary" disabled style={{ marginTop: '0.75rem' }}>
          Create Form
        </button>
      </div>

      {selectedSubmission && (
        <div className="seo-modal-backdrop" onClick={() => setSelectedSubmission(null)}>
          <div className="seo-modal forms-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="seo-panel-header">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Submission</h2>
              <button type="button" className="secondary" onClick={() => setSelectedSubmission(null)}>
                Close
              </button>
            </div>
            <dl className="settings-dl" style={{ marginTop: '1rem' }}>
              <dt>Date</dt>
              <dd>{new Date(selectedSubmission.createdAt).toLocaleString()}</dd>
              <dt>Name</dt>
              <dd>{selectedSubmission.name}</dd>
              <dt>Email</dt>
              <dd>{selectedSubmission.email}</dd>
              {selectedSubmission.pagePath && (
                <>
                  <dt>Page</dt>
                  <dd>{selectedSubmission.pagePath}</dd>
                </>
              )}
            </dl>
            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Message</label>
              <pre className="seo-prompt-content" style={{ maxHeight: '240px' }}>
                {selectedSubmission.message}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
