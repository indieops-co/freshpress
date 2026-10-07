import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Standard "this is a paid feature" panel — rendered wherever the workspace tier
 * lacks an entitlement (auth.features from /auth/me). Mirrors the settings-card
 * styling so it sits naturally in place of the gated UI. When the vendor has
 * configured an upgrade URL (FRESHPRESS_CHECKOUT_URL → auth.upgradeUrl), it also
 * renders an Upgrade button that links out to checkout.
 */
export default function UpgradeNotice({ title, children }: { title: string; children: ReactNode }) {
  const { upgradeUrl } = useAuth();
  return (
    <section className="panel settings-card settings-card--full">
      <h3>{title}</h3>
      <p className="dash-page__muted">
        {children} <strong>Available on paid plans.</strong>
      </p>
      {upgradeUrl && (
        <a
          className="btn btn--primary"
          href={upgradeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Upgrade
        </a>
      )}
    </section>
  );
}
