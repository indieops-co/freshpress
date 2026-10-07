/**
 * Marketing site routes — the public front door.
 *
 * When the gate is on: static marketing page at '/' (from marketing/public/)
 * plus the canonical legal docs served as plain text from the repo root.
 * When off: '/' redirects to the editor so buyer instances get a sensible
 * landing instead of a 404. Mount AFTER /api, /media, and /editor so it can
 * never shadow them.
 */

import express from 'express';
import { join } from 'node:path';
import type { Express } from 'express';
import { marketingEnabled } from './gate.js';

const LEGAL_DOCS: Record<string, string> = {
  eula: 'EULA.md', // FreshPress Purchase Terms (Pro)
  license: 'COMMERCIAL-LICENSE.md', // IndieOps Commercial License (Pro)
  free: 'LICENSE-FREE.txt', // IndieOps Free License (free edition)
};

export function mountMarketing(app: Express): void {
  if (!marketingEnabled()) {
    app.get('/', (_req, res) => {
      res.redirect('/editor');
    });
    return;
  }

  app.use(express.static(join(process.cwd(), 'marketing', 'public')));

  // Extensionless pricing page (static serves /pricing.html; this makes /pricing work too).
  app.get('/pricing', (_req, res) => {
    res.sendFile(join(process.cwd(), 'marketing', 'public', 'pricing.html'));
  });

  app.get('/legal/:doc', (req, res) => {
    const file = LEGAL_DOCS[req.params.doc];
    if (!file) {
      res.status(404).json({ error: 'Unknown document' });
      return;
    }
    // Set type before sendFile: send() only derives Content-Type when none
    // is set, and .md would otherwise go out as text/markdown (a download
    // prompt in some browsers instead of readable text).
    res.type('text/plain').sendFile(join(process.cwd(), file));
  });
}
