import { useEffect, useState } from 'react';
import { api, type TeamMember } from '../../api';
import { useAuth } from '../../context/AuthContext';

const ROLES: TeamMember['role'][] = ['owner', 'admin', 'member'];

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showInvite, setShowInvite] = useState(false);

  // New-member form
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('member');
  const [canPublish, setCanPublish] = useState(false);

  function load() {
    api
      .listTeamMembers()
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load team'));
  }

  useEffect(load, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !displayName.trim() || !password) {
      setError('Name, email, and an initial password are required.');
      return;
    }
    try {
      await api.createTeamMember({
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        role,
        canPublish: role === 'owner' ? true : canPublish,
      });
      setEmail('');
      setDisplayName('');
      setPassword('');
      setRole('member');
      setCanPublish(false);
      setShowInvite(false);
      setStatus('Team member added — share the password with them to sign in.');
      setTimeout(() => setStatus(''), 3500);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  }

  async function toggleCanPublish(m: TeamMember, next: boolean) {
    setError('');
    try {
      await api.updateTeamMember(m.id, { canPublish: next });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission');
    }
  }

  async function changeRole(m: TeamMember, next: TeamMember['role']) {
    setError('');
    try {
      await api.updateTeamMember(m.id, { role: next });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    }
  }

  async function removeMember(m: TeamMember) {
    if (!window.confirm(`Remove ${m.displayName} (${m.email}) from the workspace?`)) return;
    setError('');
    try {
      await api.deleteTeamMember(m.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      <p className="dash-page__muted">
        Team members sign in with their email and password. <strong>Publish rights</strong> control who
        can push changes live — members without them can still edit and <em>Submit for review</em>.
        Owners always have full rights.
      </p>

      <div style={{ margin: '1rem 0' }}>
        <button type="button" onClick={() => setShowInvite((v) => !v)}>
          {showInvite ? 'Cancel' : '+ Add team member'}
        </button>
      </div>

      {showInvite && (
        <form onSubmit={addMember} className="panel" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr 1fr' }}>
            <label>
              Name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Smith" />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@agency.com" />
            </label>
            <label>
              Initial password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Share this with them"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as TeamMember['role'])}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={role === 'owner' ? true : canPublish}
              disabled={role === 'owner'}
              onChange={(e) => setCanPublish(e.target.checked)}
            />
            Can publish / deploy to live sites
          </label>
          <div style={{ marginTop: '1rem' }}>
            <button type="submit">Add member</button>
          </div>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Role</th>
              <th style={th}>Can publish</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = user?.id === m.id;
              return (
                <tr key={m.id}>
                  <td style={td}>
                    {m.displayName}
                    {isSelf && <span className="dash-page__muted"> (you)</span>}
                  </td>
                  <td style={td}>{m.email}</td>
                  <td style={td}>
                    <select
                      value={m.role}
                      onChange={(e) => void changeRole(m, e.target.value as TeamMember['role'])}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={m.role === 'owner' ? true : m.permissions.canPublish}
                      disabled={m.role === 'owner'}
                      onChange={(e) => void toggleCanPublish(m, e.target.checked)}
                    />
                  </td>
                  <td style={td}>
                    {!isSelf && (
                      <button type="button" className="secondary" onClick={() => void removeMember(m)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>
                  <span className="dash-page__muted">No team members yet.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: '1px solid var(--border)',
  fontSize: '0.8rem',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};
const td: React.CSSProperties = { padding: '0.5rem', borderBottom: '1px solid var(--border)' };
