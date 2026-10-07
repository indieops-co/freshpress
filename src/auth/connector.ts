import type { Request, Response, NextFunction } from 'express';
import { extractBearer } from './middleware.js';
import { getConnectorTokenStore, hashConnectorToken } from '../storage/connector-tokens.js';

/**
 * Guard for the read-only Connect API. A valid per-site connector token resolves
 * to the site it grants access to; siteId comes from the token, NOT the URL, so
 * the plugin only ever needs a base URL + token. Distinct from requireSiteMember
 * (client passwords) — connector tokens are long-lived, single-site, read-only,
 * and independently revocable.
 *
 * NOTE: add 'connector' to the AuthRole union in src/auth/types.ts:
 *   export type AuthRole = 'admin' | 'client' | 'connector';
 */
export function requireConnectorToken(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: 'Connector token required' });
      return;
    }

    const store = await getConnectorTokenStore();
    const tokenHash = hashConnectorToken(token);
    const siteId = await store.resolveSiteId(tokenHash);
    if (!siteId) {
      res.status(401).json({ error: 'Invalid or revoked connector token' });
      return;
    }

    // Fire-and-forget last-used stamp — never block the request on it.
    store.touch(tokenHash).catch(() => {});

    req.auth = { role: 'connector', siteId };
    next();
  })().catch(next);
}
