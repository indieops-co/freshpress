import { useEffect, useState } from 'react';
import { getToken } from '../api';

type LicenseState =
  | 'licensed'
  | 'grace'
  | 'no-key'
  | 'reverted-free'
  | 'invalid'
  | 'unreachable';

interface LicenseStatus {
  state: LicenseState;
  tier: string;
  expiresAt: string | null;
  validatedAt: string | null;
  message?: string;
}

// Healthy states show nothing; these four warrant a heads-up.
const PROBLEM_STATES: ReadonlySet<LicenseState> = new Set([
  'grace',
  'unreachable',
  'invalid',
  'reverted-free',
]);

function defaultText(state: LicenseState): string {
  switch (state) {
    case 'grace':
      return 'License server unreachable — using your cached plan for now (grace period).';
    case 'unreachable':
      return "Couldn't reach the license server; your plan is unchanged. Retrying automatically.";
    case 'invalid':
      return 'Your license is not valid — running on the free tier.';
    case 'reverted-free':
      return 'Your plan reverted to the free tier.';
    default:
      return '';
  }
}

/**
 * Surfaces a licensing problem (grace / unreachable / invalid / reverted) to admins.
 * Fetches the paid-only `GET /api/license/status`; in the free build that route 404s and
 * this renders nothing. Self-contained so App only has to mount it for admin sessions.
 */
export default function LicenseBanner() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    fetch('/api/license/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<LicenseStatus>) : null))
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        /* free build / offline — leave status null, render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !status || !PROBLEM_STATES.has(status.state)) return null;

  const severity =
    status.state === 'grace' || status.state === 'unreachable' ? 'warning' : 'danger';

  return (
    <div className={`license-banner license-banner--${severity}`} role="status">
      <span className="license-banner__label">License</span>
      <span className="license-banner__text">{status.message ?? defaultText(status.state)}</span>
      <button
        type="button"
        className="license-banner__dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss license notice"
      >
        ×
      </button>
    </div>
  );
}
