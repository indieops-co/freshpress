import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  siteId: string;
}

export default function ClientAccessInvite({ siteId }: Props) {
  const [inviteTo, setInviteTo] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [editorUrl, setEditorUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getEmailSettings(siteId)
      .then((data) => setEditorUrl(data.editorUrl))
      .catch(() => {});
  }, [siteId]);

  async function sendInvite() {
    if (!inviteTo.trim()) return;
    setError('');
    setStatus('Sending invite…');
    try {
      await api.sendClientInvite(siteId, inviteTo.trim(), agencyName.trim() || undefined);
      setStatus('Invite sent');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
      setStatus('');
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}
      <div className="form-group">
        <label>Client editor invite</label>
        <input value={inviteTo} onChange={(e) => setInviteTo(e.target.value)} placeholder="client@example.com" />
      </div>
      <div className="form-group">
        <label>Agency name (optional)</label>
        <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Acme Web Studio" />
      </div>
      <button type="button" onClick={sendInvite}>
        Email client invite
      </button>
      {editorUrl && (
        <p className="hint" style={{ marginTop: '0.75rem' }}>
          Editor link: {editorUrl}
        </p>
      )}
    </div>
  );
}
