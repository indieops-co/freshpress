import { createContext, useContext, type ReactNode } from 'react';

export type AuthRole = 'admin' | 'client';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  permissions?: { canPublish: boolean };
}

export interface AuthWorkspace {
  id: string;
  name: string;
  planTier: 'free' | 'pro' | 'agency';
}

export interface AuthState {
  role: AuthRole;
  user?: AuthUser;
  workspace?: AuthWorkspace;
  /** Feature entitlements from /auth/me — gate opt-in UI on these (absent ⇒ allowed). */
  features?: Record<string, boolean>;
  /** Vendor-configured upgrade/checkout URL (env FRESHPRESS_CHECKOUT_URL); absent ⇒ no CTA button. */
  upgradeUrl?: string;
  /**
   * Whether the current workspace user may publish. Absent for client sessions —
   * clients read their publish capability from the site's `capabilities` payload instead.
   */
  canPublish?: boolean;
  siteId?: string;
  /** True when the session was issued by GET /api/demo/session (DEMO_MODE=1). */
  isDemo?: boolean;
}

const AuthContext = createContext<AuthState>({ role: 'admin' });

export function AuthProvider({ value, children }: { value: AuthState; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
