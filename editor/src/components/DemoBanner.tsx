import { useState } from 'react';

interface EarlyAccessModalProps {
  onClose: () => void;
}

function EarlyAccessModal({ onClose }: EarlyAccessModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'demo' }),
      });
      if (res.ok) {
        setStatus('success');
      } else {
        const body = (await res.json()) as { error?: string };
        setErrorMsg(body.error ?? 'Something went wrong. Please try again.');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="demo-modal-overlay" onClick={onClose}>
      <div
        className="demo-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="early-access-title"
      >
        {status === 'success' ? (
          <>
            <h2 id="early-access-title" className="demo-modal__title">
              You're on the list!
            </h2>
            <p className="demo-modal__body">
              We'll reach out when FreshPress is ready for you. Thanks for your interest!
            </p>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <h2 id="early-access-title" className="demo-modal__title">
              Get Early Access
            </h2>
            <p className="demo-modal__body">
              FreshPress is currently in private access. Drop your email and we'll reach out when
              it's your turn.
            </p>
            <form onSubmit={(e) => void handleSubmit(e)} className="demo-modal__form">
              <label htmlFor="early-access-email" className="demo-modal__label">
                Email address
              </label>
              <input
                id="early-access-email"
                type="email"
                className="demo-modal__input"
                placeholder="you@agency.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={status === 'submitting'}
              />
              {status === 'error' && (
                <p className="demo-modal__error">{errorMsg}</p>
              )}
              <div className="demo-modal__actions">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={status === 'submitting' || !email.trim()}
                >
                  {status === 'submitting' ? 'Sending…' : 'Notify me'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={onClose}>
                  Not now
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function DemoBanner() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="demo-banner" role="status">
        <span className="demo-banner__label">Demo</span>
        <span className="demo-banner__text">
          You're viewing a live demo — changes reset nightly.
        </span>
        <button
          className="demo-banner__cta btn btn--primary btn--sm"
          onClick={() => setModalOpen(true)}
        >
          Get Early Access
        </button>
      </div>
      {modalOpen && <EarlyAccessModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
