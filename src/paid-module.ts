import type { Express } from 'express';

/**
 * Contract between the free core and the proprietary paid overlay mounted at
 * `src/paid/`. The core dynamically imports `./paid/index.js` at boot; when the
 * directory is absent the app runs as the free build (routes 404, tiers stay
 * wherever the workspace puts them). The overlay's default export implements this.
 */
export interface PaidModule {
  /**
   * Licensing hook — validates the deployment's license and raises the workspace
   * tier accordingly. Runs once at boot, before routes mount. Must not throw for
   * an absent/invalid license (that just means the free tier).
   */
  activate(): Promise<void>;
  /** Mount paid-only routers (brand research, billing). */
  registerRoutes(app: Express): void;
}
