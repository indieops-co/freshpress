import { useState } from 'react';

interface Props {
  onLogin: (token: string, opts?: { siteId?: string; role?: 'admin' | 'client' }) => void;
}

type AdminMode = 'email' | 'master';

export default function Login({ onLogin }: Props) {
  const [mode, setMode] = useState<'admin' | 'client'>('admin');
  const [adminMode, setAdminMode] = useState<AdminMode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setTokenInput] = useState('');
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState('');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');

  async function handleAdminEmail(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Login failed');
      }
      const data = (await res.json()) as { token: string };
      onLogin(data.token, { role: 'admin' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  async function handleMasterKey(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('Please enter your master key.');
      return;
    }
    try {
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!meRes.ok) throw new Error('Invalid master key');

      const me = (await meRes.json()) as { workspace?: { id: string } };
      if (!me.workspace) {
        setBootstrapping(true);
        return;
      }

      const sitesRes = await fetch('/api/sites', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!sitesRes.ok) throw new Error('Invalid master key');
      onLogin(token.trim(), { role: 'admin' });
    } catch {
      setError('Login failed — check your master key.');
    }
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!displayName.trim() || !email.trim() || !password) {
      setError('Display name, email, and password are required.');
      return;
    }
    try {
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterKey: token.trim(),
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          workspaceName: workspaceName.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Setup failed');
      }
      const data = (await res.json()) as { token: string };
      onLogin(data.token, { role: 'admin' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    }
  }

  async function handleClient(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('Please enter your site password.');
      return;
    }
    if (!siteId.trim()) {
      setError('Site ID is required for client login.');
      return;
    }
    try {
      const path = `/sites/${siteId.trim()}`;
      const res = await fetch(`/api${path}`, {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!res.ok) throw new Error('Invalid credentials');
      onLogin(token.trim(), { siteId: siteId.trim(), role: 'client' });
    } catch {
      setError('Login failed — check your password and site ID.');
    }
  }

  if (bootstrapping) {
    return (
      <div className="login-page">
        <div className="panel">
          <h1>Set up workspace</h1>
          <p>Create your admin account — master key verified.</p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={handleBootstrap}>
            <div className="form-group">
              <label htmlFor="workspaceName">Agency name</label>
              <input
                id="workspaceName"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="My Agency"
              />
            </div>
            <div className="form-group">
              <label htmlFor="displayName">Your name</label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@agency.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" style={{ width: '100%' }}>
              Create workspace
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="panel">
        <h1>FreshPress</h1>
        <p>Edit your site content — design stays locked.</p>

        {error && <div className="error-banner">{error}</div>}

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={mode === 'admin' ? '' : 'secondary'}
            onClick={() => setMode('admin')}
          >
            Admin
          </button>
          <button
            type="button"
            className={mode === 'client' ? '' : 'secondary'}
            onClick={() => setMode('client')}
          >
            Client
          </button>
        </div>

        {mode === 'admin' && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                type="button"
                className={adminMode === 'email' ? '' : 'secondary'}
                onClick={() => setAdminMode('email')}
              >
                Email
              </button>
              <button
                type="button"
                className={adminMode === 'master' ? '' : 'secondary'}
                onClick={() => setAdminMode('master')}
              >
                Master key
              </button>
            </div>

            {adminMode === 'email' ? (
              <form onSubmit={handleAdminEmail}>
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@agency.com"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button type="submit" style={{ width: '100%' }}>
                  Sign in
                </button>
              </form>
            ) : (
              <form onSubmit={handleMasterKey}>
                <div className="form-group">
                  <label htmlFor="token">Master key</label>
                  <input
                    id="token"
                    type="password"
                    value={token}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Your MASTER_KEY"
                  />
                </div>
                <button type="submit" style={{ width: '100%' }}>
                  Sign in
                </button>
              </form>
            )}
          </>
        )}

        {mode === 'client' && (
          <form onSubmit={handleClient}>
            <div className="form-group">
              <label htmlFor="siteId">Site ID</label>
              <input
                id="siteId"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                placeholder="abc123xyz"
              />
            </div>
            <div className="form-group">
              <label htmlFor="clientToken">Site password</label>
              <input
                id="clientToken"
                type="password"
                value={token}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Client password"
              />
            </div>
            <button type="submit" style={{ width: '100%' }}>
              Sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
