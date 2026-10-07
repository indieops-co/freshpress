import { z } from 'zod';

export const PlanTierSchema = z.enum(['free', 'pro', 'agency']);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const WorkspaceUserRoleSchema = z.enum(['owner', 'admin', 'member']);
export type WorkspaceUserRole = z.infer<typeof WorkspaceUserRoleSchema>;

export const UserPreferencesSchema = z.object({
  defaultHumanizerMode: z.enum(['simple', 'skill']).optional(),
  lastSiteId: z.string().optional(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * Per-user capabilities. Today the only enforced distinction between team members
 * is Save vs Publish; `canPublish` gates the publish/deploy/rollback routes.
 * Defaults to true so existing stored users (and every owner) keep full rights.
 */
export const UserPermissionsSchema = z.object({
  canPublish: z.boolean().default(true),
});
export type UserPermissions = z.infer<typeof UserPermissionsSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  planTier: PlanTierSchema.default('free'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceUserSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  email: z.string().email(),
  passwordHash: z.string(),
  displayName: z.string(),
  role: WorkspaceUserRoleSchema,
  preferences: UserPreferencesSchema.default({}),
  permissions: UserPermissionsSchema.default({ canPublish: true }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceUser = z.infer<typeof WorkspaceUserSchema>;

export const SessionSchema = z.object({
  tokenHash: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Request auth — admin (agency), client (site password), or connector (per-site WP plugin token). */
export type AuthRole = 'admin' | 'client' | 'connector';

export interface AuthContext {
  role: AuthRole;
  userId?: string;
  workspaceId?: string;
  siteId?: string;
  userRole?: WorkspaceUserRole;
  planTier?: PlanTier;
  /**
   * Whether this actor may publish/deploy/rollback. For workspace users this is
   * their per-user permission (owner + master-key are always true); for clients it
   * is resolved per-site from `SiteMeta.clientCanPublish` inside the capability guard.
   */
  canPublish?: boolean;
  /** True for auto-sessions issued by GET /api/demo/session (DEMO_MODE=1 only). */
  isDemo?: boolean;
}

export interface AuthMeResponse {
  role: AuthRole;
  /** Set to true on tokens issued by GET /api/demo/session */
  isDemo?: boolean;
  user?: {
    id: string;
    email: string;
    displayName: string;
    role: WorkspaceUserRole;
    preferences: UserPreferences;
    permissions: UserPermissions;
  };
  /** Whether the current workspace user may publish/deploy — the editor gates its Publish button on this. */
  canPublish?: boolean;
  workspace?: {
    id: string;
    name: string;
    planTier: PlanTier;
  };
  /** Feature entitlements for the workspace's tier — the editor gates opt-in UI on these. */
  features?: Record<string, boolean>;
  /**
   * Richer entitlements: flags plus numeric limits (null = unlimited). Supersedes
   * `features`, which is kept for editor back-compat during the migration.
   */
  entitlements?: {
    features: Record<string, boolean>;
    limits: Record<string, number | null>;
  };
  /**
   * Vendor-configured upgrade/checkout URL (env `FRESHPRESS_CHECKOUT_URL`), so the editor's
   * UpgradeNotice can link out to it. Absent when unset — the editor then shows no button.
   */
  upgradeUrl?: string;
  siteId?: string;
}
