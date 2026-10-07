import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { routeParam } from '../util/params.js';
import { getWorkspaceUsersStore, hashSessionToken } from '../storage/workspace-users.js';
import type { AuthContext, AuthRole, WorkspaceUserRole } from './types.js';

export type { AuthContext, AuthRole };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const MASTER_KEY = process.env.MASTER_KEY ?? '';

/** Simple SHA-256 hash for passwords (no native bcrypt dep needed for MVP) */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  const a = Buffer.from(hashPassword(password));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function resolveAdminAuth(token: string): Promise<AuthContext | null> {
  if (MASTER_KEY && safeCompare(token, MASTER_KEY)) {
    const store = await getWorkspaceUsersStore();
    const workspace = await store.getWorkspace();
    return {
      role: 'admin',
      workspaceId: workspace?.id,
      planTier: workspace?.planTier,
      // Break-glass admin always retains full rights, mirroring the entitlements
      // rule that an undefined tier passes any gate.
      canPublish: true,
    };
  }

  const store = await getWorkspaceUsersStore();
  const session = await store.getSession(hashSessionToken(token));
  if (!session || new Date(session.expiresAt) <= new Date()) return null;

  const user = await store.getUserById(session.userId);
  const workspace = await store.getWorkspace();
  if (!user || !workspace) return null;

  return {
    role: 'admin',
    userId: user.id,
    workspaceId: workspace.id,
    userRole: user.role,
    planTier: workspace.planTier,
    // Owners always publish; other members honour their per-user permission.
    canPublish: user.role === 'owner' ? true : user.permissions.canPublish,
  };
}

/** Require admin session or master key */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const auth = await resolveAdminAuth(token);
    if (!auth) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.auth = auth;
    next();
  })().catch(next);
}

/**
 * Any authenticated workspace user (owner/admin/member). Use for member-accessible
 * routes such as listing sites to navigate the dashboard.
 */
export const requireWorkspaceUser = requireAdmin;

/** Require admin OR valid client password scoped to siteId param */
export function requireSiteMember(
  getPasswordHash: (siteId: string) => Promise<string | undefined>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const siteId = routeParam(req.params.siteId);
    const token = extractBearer(req);

    if (token) {
      const adminAuth = await resolveAdminAuth(token);
      if (adminAuth) {
        req.auth = { ...adminAuth, siteId };
        next();
        return;
      }
    }

    if (!token || !siteId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hash = await getPasswordHash(siteId);
    if (!hash) {
      res.status(401).json({ error: 'Client access not configured for this site' });
      return;
    }

    if (!verifyPassword(token, hash)) {
      res.status(401).json({ error: 'Invalid site password' });
      return;
    }

    req.auth = { role: 'client', siteId };
    next();
  };
}

/** @deprecated use requireSiteMember */
export const requireSiteAccess = requireSiteMember;

/** Admin-only actions — blocks client role */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Whether a workspace role may perform owner/admin-level actions. Master-key sessions carry
 * no `userRole` and pass as break-glass. The save-only `member` role is the one this blocks.
 */
export function isWorkspaceAdminRole(userRole?: WorkspaceUserRole): boolean {
  return userRole === undefined || userRole === 'owner' || userRole === 'admin';
}

/**
 * Owner/admin-level guard — blocks the save-only `member` role. Works standalone (as the
 * `requireOwner` alias on config/mutation routes) or after a site-auth guard: it reuses an
 * existing `req.auth`, otherwise authenticates the bearer token itself.
 */
export function requireWorkspaceAdmin(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    let auth = req.auth;
    if (!auth) {
      const token = extractBearer(req);
      if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const resolved = await resolveAdminAuth(token);
      if (!resolved) {
        res.status(401).json({ error: 'Invalid or expired session' });
        return;
      }
      auth = resolved;
      req.auth = auth;
    }

    if (auth.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    if (isWorkspaceAdminRole(auth.userRole)) {
      next();
      return;
    }
    res.status(403).json({
      error: 'This action requires an owner or admin — members have edit-only access.',
    });
  })().catch(next);
}

/**
 * Owner-level actions: site create/delete, page ingest/delete, workspace config, team,
 * integrations, content generation. Enforces owner/admin (blocks the member role).
 * (Named "owner" historically; members and clients are rejected.)
 */
export const requireOwner = requireWorkspaceAdmin;

/** @deprecated use adminOnly */
export const ownerOnly = adminOnly;

/** Helper for route guards that need admin but not client */
export function isAdmin(req: Request): boolean {
  return req.auth?.role === 'admin';
}

/**
 * Pure resolver for the publish capability — the single source of truth used by both
 * the route guard and the unit tests. Admins (workspace users + master key) carry their
 * `canPublish` on the auth context; a `false` blocks, anything else (incl. undefined
 * break-glass) allows. Site-password clients are allowed only when the site opts in via
 * `clientCanPublish`.
 */
export function canActorPublish(
  auth: AuthContext | undefined,
  siteMeta?: { clientCanPublish?: boolean } | null
): boolean {
  if (!auth) return false;
  if (auth.role === 'admin') return auth.canPublish !== false;
  if (auth.role === 'client') return siteMeta?.clientCanPublish === true;
  return false;
}

/**
 * Require a capability. Runs after a site-auth guard has populated `req.auth`.
 * For the 'publish' capability on a client, the site's `clientCanPublish` flag is
 * resolved via storage; admins are decided purely from their auth context.
 */
export function requireCapability(capability: 'publish') {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const auth = req.auth;
      if (!auth) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      let siteMeta: { clientCanPublish?: boolean } | null = null;
      if (auth.role === 'client') {
        const siteId = routeParam(req.params.siteId);
        // Imported lazily to keep the storage layer out of this module's load-time deps.
        const { getStorage } = await import('../storage/filesystem.js');
        const storage = await getStorage();
        const site = siteId ? await storage.getSite(siteId) : null;
        siteMeta = site?.meta ?? null;
      }

      if (!canActorPublish(auth, siteMeta)) {
        res.status(403).json({
          error:
            capability === 'publish'
              ? 'You do not have permission to publish this site. Submit your changes for review instead.'
              : 'You do not have permission for this action.',
          capability,
        });
        return;
      }
      next();
    })().catch(next);
  };
}
