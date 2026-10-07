import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  siteId: string;
  /** From GET /sites/:id/email — empty until email delivery is configured. */
  signupSnippet: string;
}

type Subscriber = Awaited<ReturnType<typeof api.listSubscribers>>[number];
type SignupWebhook = Awaited<ReturnType<typeof api.listSignupWebhooks>>[number];

const STATUS_LABEL: Record<Subscriber['status'], string> = {
  pending: 'Pending confirm',
  confirmed: 'Confirmed',
  unsubscribed: 'Unsubscribed',
};

export default function SignupsPanel({ siteId, signupSnippet }: Props) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [webhooks, setWebhooks] = useState<SignupWebhook[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<{ webhookId: string; secret: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  function loadData() {
    return Promise.all([api.listSubscribers(siteId), api.listSignupWebhooks(siteId)])
      .then(([subs, hooks]) => {
        setSubscribers(subs);
        setWebhooks(hooks);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  async function addWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!newWebhookUrl.trim()) return;
    setError('');
    try {
      const created = await api.createSignupWebhook(siteId, newWebhookUrl.trim());
      setRevealedSecret({ webhookId: created.webhook.id, secret: created.secret });
      setNewWebhookUrl('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add webhook');
    }
  }

  async function toggleWebhook(hook: SignupWebhook) {
    setError('');
    try {
      await api.updateSignupWebhook(siteId, hook.id, { enabled: !hook.enabled });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update webhook');
    }
  }

  async function removeWebhook(hook: SignupWebhook) {
    setError('');
    try {
      await api.deleteSignupWebhook(siteId, hook.id);
      if (revealedSecret?.webhookId === hook.id) setRevealedSecret(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    }
  }

  async function copySnippet() {
    if (!signupSnippet) return;
    await navigator.clipboard.writeText(signupSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const confirmedCount = subscribers.filter((s) => s.status === 'confirmed').length;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Signup form snippet</h3>
          <button type="button" className="secondary" onClick={copySnippet} disabled={!signupSnippet}>
            {copied ? '✓ Copied' : '⎘ Copy HTML'}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: '0.75rem' }}>
          Email signups use double opt-in: visitors confirm via email before they count. On WordPress sites, any
          form marked <code>data-fp-form=&quot;signup&quot;</code> is wired automatically on sync.
        </p>
        <pre className="seo-prompt-content" style={{ maxHeight: '160px' }}>
          {signupSnippet || 'Configure email delivery in Site Settings → Email to generate a snippet.'}
        </pre>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
          Subscribers ({confirmedCount} confirmed / {subscribers.length} total)
        </h3>
        {subscribers.length === 0 ? (
          <p className="hint">No signups yet.</p>
        ) : (
          <ul className="slot-list">
            {subscribers.slice(0, 50).map((s) => (
              <li key={s.id} className="slot-item" style={{ cursor: 'default' }}>
                <div>
                  <strong>{s.email}</strong>
                  {s.name ? ` — ${s.name}` : ''}
                </div>
                <div className="tag">{STATUS_LABEL[s.status]}</div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  {new Date(s.createdAt).toLocaleString()}
                  {s.pagePath ? ` · ${s.pagePath}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Signup webhooks</h3>
        <p className="hint" style={{ marginBottom: '0.75rem' }}>
          POSTed when a subscriber confirms or unsubscribes — connect Zapier, a CRM, or any outreach tool.
          Payloads are signed with HMAC-SHA256 in the <code>X-FreshPress-Signature</code> header.
        </p>

        {revealedSecret && (
          <div className="status-ok" style={{ marginBottom: '0.75rem' }}>
            Webhook created. Signing secret (shown once — store it now):{' '}
            <code>{revealedSecret.secret}</code>
          </div>
        )}

        {webhooks.length > 0 && (
          <ul className="slot-list" style={{ marginBottom: '0.75rem' }}>
            {webhooks.map((hook) => (
              <li key={hook.id} className="slot-item" style={{ cursor: 'default' }}>
                <div style={{ wordBreak: 'break-all' }}>{hook.url}</div>
                <div className="tag">{hook.enabled ? 'Enabled' : 'Disabled'}</div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button type="button" className="secondary" onClick={() => toggleWebhook(hook)}>
                    {hook.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="secondary" onClick={() => removeWebhook(hook)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addWebhook} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={newWebhookUrl}
            onChange={(e) => setNewWebhookUrl(e.target.value)}
            placeholder="https://hooks.example.com/freshpress"
            style={{ flex: 1 }}
          />
          <button type="submit">Add webhook</button>
        </form>
      </div>
    </>
  );
}
