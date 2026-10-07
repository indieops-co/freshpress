/**
 * Demo mode middleware — active only when DEMO_MODE=1.
 *
 * Responsibilities:
 *  - Block destructive or sensitive operations so demo visitors can't break shared state
 *  - Export a shared rate limiter for AI routes
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';

export const DEMO_MODE = process.env.DEMO_MODE === '1';

/**
 * Path markers for AI-backed routes under the limiter's mounts. Everything
 * else under /api/sites (plain content reads/writes) must NOT count against
 * the AI budget — the limiter is mounted at the /api/sites prefix, and
 * counting ordinary dashboard GETs starved real visitors out of the demo
 * after ~20 clicks ("No client sites yet" + rate-limit banner).
 */
const AI_ROUTE_MARKERS: ReadonlyArray<string> = [
  '/chat',
  '/generate', // site + design + social + media + brand-research generate routes
  '/humanize',
  '/detect-ai',
  '/auto-draft',
  '/extract-brand',
  '/regenerate-cards',
  '/design/preview',
  '/design/apply',
  '/design/import', // parseDesignMd (AI parse when a key resolves)
];

/** The demoAiLimiter skip decision, extracted pure for direct unit testing. Expects the FULL path (baseUrl + path). */
export function isAiLimitedInDemo(method: string, path: string): boolean {
  // The only AI-backed GET is /design/preview/:themeId (parseDesignMd normalize).
  if (method === 'GET' && !path.includes('/design/preview')) return false;
  return AI_ROUTE_MARKERS.some((marker) => path.includes(marker));
}

/**
 * Rate limiter for AI-heavy routes in demo mode.
 * 20 requests per IP per hour. No-op when not in demo mode, and skips
 * non-AI routes under its mounts (see isAiLimitedInDemo).
 */
export const demoAiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: DEMO_MODE ? 20 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  // req.path is relative to the mount point, so rebuild the full path.
  skip: (req) => !DEMO_MODE || !isAiLimitedInDemo(req.method, `${req.baseUrl}${req.path}`),
  message: { error: 'AI rate limit reached. Please try again in an hour.' },
});

/** Paths that are blocked in demo mode (exact match). */
const BLOCKED_EXACT: ReadonlySet<string> = new Set([
  '/api/auth/bootstrap',
]);

/** Blocked (method, path-substring) pairs. */
const BLOCKED_OPERATIONS: ReadonlyArray<{ method: string; pathIncludes: string }> = [
  { method: 'POST', pathIncludes: '/publish' },
  { method: 'DELETE', pathIncludes: '/sites/' },
  { method: 'POST', pathIncludes: '/wordpress-import' },
  // Ingest persists arbitrary fetched HTML verbatim — with one shared demo
  // workspace that's a stored-XSS vector between anonymous visitors. The
  // wizard's apply-generated stays OPEN: its pages go through
  // validateGeneratedPage, which rejects script content in templates.
  { method: 'POST', pathIncludes: '/pages/ingest' },
  { method: 'PUT', pathIncludes: '/integrations' },
  { method: 'PATCH', pathIncludes: '/integrations' },
];

/** The demoGuard decision, extracted pure for direct unit testing. */
export function isBlockedInDemo(method: string, path: string): boolean {
  if (BLOCKED_EXACT.has(path)) return true;
  return BLOCKED_OPERATIONS.some((op) => method === op.method && path.includes(op.pathIncludes));
}

/**
 * Middleware that blocks destructive operations in demo mode.
 * Mount globally in server.ts before other API routers.
 */
export function demoGuard(req: Request, res: Response, next: NextFunction): void {
  if (!DEMO_MODE) {
    next();
    return;
  }

  if (isBlockedInDemo(req.method, req.path)) {
    res.status(403).json({ error: 'This action is disabled in the demo.' });
    return;
  }

  next();
}
