import 'dotenv/config';
import { validateHostedProfile } from './hosted/validate.js';

validateHostedProfile();
import express from 'express';
import cors from 'cors';
import { join } from 'node:path';
import { ingestUrl, ingestHtml } from './ingest/index.js';
import { renderPage } from './content/render.js';
import { validateChanges, mergeValidatedSlots } from './guardian/validate.js';
import sitesRouter from './api/sites.js';
import publishRouter from './api/publish.js';
import reviewRouter from './api/review.js';
import chatRouter from './api/chat.js';
import seoPromptsRouter from './api/seo-prompts.js';
import emailRouter from './api/email.js';
import publicRouter from './api/public.js';
import signupsRouter from './api/signups.js';
import wordpressRouter from './api/wordpress.js';
import wordpressImportRouter from './api/wordpress-import.js';
import integrationsRouter from './api/integrations.js';
import designRouter from './api/design.js';
import siteGenerationRouter from './api/site-generation.js';
import emailBrandRouter from './api/email-brand.js';
import emailInboundRouter from './api/email-inbound.js';
import emailInboundWebhookRouter from './api/email-inbound-webhook.js';
import emailInboxRouter from './api/email-inbox.js';
import blogSiloRouter from './api/blog-silo.js';
import campaignsRouter from './api/campaigns.js';
import adminExportRouter from './api/admin-export.js';
import humanizerRouter from './api/humanizer.js';
import authRouter from './api/auth.js';
import teamRouter from './api/team.js';
import socialPostsRouter from './api/social-posts.js';
import earlyAccessRouter from './api/early-access.js';
import mediaGenRouter from './api/media-gen.js';
import connectRouter from './api/connect.js';
import { demoGuard, demoAiLimiter } from './demo/middleware.js';
import { mountMarketing } from './marketing/router.js';
import { getStorage } from './storage/filesystem.js';
import { sendScheduledEmails } from './scheduler/send-scheduled-emails.js';
import { sendDueCampaignSteps } from './scheduler/send-campaign-steps.js';
import { skipWhileRunning } from './scheduler/skip-while-running.js';
import type { PaidModule } from './paid-module.js';
import type { PageContent, SlotChange } from './content/types.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Mounted before express.json(): signature verification needs the exact raw request
// bytes, which express.json() would otherwise consume and parse before this ever ran.
app.use('/api', emailInboundWebhookRouter);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Demo mode: block destructive ops and rate-limit AI routes
app.use('/api', demoGuard);
app.use('/api/sites', demoAiLimiter);      // covers humanize, social generate, chat
app.use('/api/admin/humanizer', demoAiLimiter);

app.use('/api', sitesRouter);
app.use('/api', publishRouter);
app.use('/api', reviewRouter);
app.use('/api', chatRouter);
app.use('/api', seoPromptsRouter);
app.use('/api', emailRouter);
app.use('/api', publicRouter);
app.use('/api', signupsRouter);
app.use('/api', wordpressRouter);
app.use('/api', wordpressImportRouter);
app.use('/api', integrationsRouter);
app.use('/api', designRouter);
app.use('/api', siteGenerationRouter);
app.use('/api', emailBrandRouter);
app.use('/api', emailInboundRouter);
app.use('/api', emailInboxRouter);
app.use('/api', blogSiloRouter);
app.use('/api', campaignsRouter);
app.use('/api', adminExportRouter);
app.use('/api', humanizerRouter);
app.use('/api', authRouter);
app.use('/api', teamRouter);
app.use('/api', socialPostsRouter);
app.use('/api', earlyAccessRouter);
app.use('/api', mediaGenRouter);
app.use('/api', connectRouter);

// Paid-overlay seam: `src/paid/` is present in paid builds (vendor workspace / buyer
// install) and absent in the free build — filesystem presence is the only switch.
// The specifier is a plain-string const so tsc never statically resolves the module
// (it may not exist); Node/tsx resolve it at runtime.
let paid: PaidModule | null = null;
const PAID_SPECIFIER: string = './paid/index.js';
try {
  paid = ((await import(PAID_SPECIFIER)) as { default: PaidModule }).default;
} catch (err) {
  const code = (err as NodeJS.ErrnoException)?.code;
  const message = err instanceof Error ? err.message : '';
  // Match only when the MISSING module is the overlay entry itself. A module missing
  // *inside* the overlay also throws ERR_MODULE_NOT_FOUND, but names the overlay entry
  // in its "imported from" clause — that case must rethrow, not masquerade as free.
  const overlayAbsent =
    code === 'ERR_MODULE_NOT_FOUND' && /find (?:module|package) '[^']*paid[/\\]index/.test(message);
  // A present-but-broken overlay must fail the boot loudly — never silently
  // degrade a paying deployment to the free tier.
  if (!overlayAbsent) throw err;
  console.info('FreshPress: free build — no paid overlay present.');
}
await paid?.activate();
paid?.registerRoutes(app);

/** Serve migrated WordPress media per site */
app.use('/media/:siteId/wp-content/uploads', (req, res, next) => {
  const siteId = req.params.siteId;
  void (async () => {
    const storage = await getStorage();
    const base = join(storage.getSitePublicDir(siteId), 'wp-content', 'uploads');
    express.static(base)(req, res, next);
  })().catch(next);
});

/** Serve social-generated images per site */
app.use('/media/:siteId/social-images', (req, res, next) => {
  const siteId = req.params.siteId;
  void (async () => {
    const storage = await getStorage();
    const base = join(storage.getSitePublicDir(siteId), 'social-images');
    express.static(base)(req, res, next);
  })().catch(next);
});

/** Ingest a live URL into frozen template + slots */
app.post('/api/ingest', async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const result = await ingestUrl(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Ingest failed' });
  }
});

/** Ingest raw HTML (for testing or pasted content) */
app.post('/api/ingest/html', (req, res) => {
  try {
    const { sourceUrl, html } = req.body as { sourceUrl?: string; html?: string };
    if (!html) {
      res.status(400).json({ error: 'html is required' });
      return;
    }
    const result = ingestHtml(sourceUrl ?? 'https://example.com/', html);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Ingest failed' });
  }
});

/** Preview rendered HTML from template + slots */
app.post('/api/render', (req, res) => {
  try {
    const content = req.body as PageContent;
    if (!content?.template || !content?.slots) {
      res.status(400).json({ error: 'template and slots are required' });
      return;
    }
    const html = renderPage(content);
    res.type('html').send(html);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Render failed' });
  }
});

/** Validate and apply slot changes through the Guardian */
app.post('/api/guardian/validate', (req, res) => {
  try {
    const { content, changes } = req.body as {
      content?: PageContent;
      changes?: SlotChange[];
    };
    if (!content || !changes) {
      res.status(400).json({ error: 'content and changes are required' });
      return;
    }
    const result = validateChanges(content, changes);
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }
    const updated = mergeValidatedSlots(content, result.applied!);
    res.json({ ok: true, content: updated, html: renderPage(updated) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Validation failed' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// Editor SPA (added in chunk 3)
const editorDist = join(process.cwd(), 'editor', 'dist');
app.use('/editor', express.static(editorDist));
app.get('/editor/*', (_req, res) => {
  res.sendFile(join(editorDist, 'index.html'));
});

// Marketing site at '/' (demo/marketing instances) or '/' → /editor redirect
// (buyer/self-hosted). Mounted last so it can never shadow /api, /media, /editor.
mountMarketing(app);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`FreshPress API listening on http://localhost:${PORT}`);
  });
  // Single-instance only, no lock/leader-election — fine at current scale.
  // Campaign sends skip a tick while the previous run is still going (a slow batch must not overlap).
  const campaignTick = skipWhileRunning(() => sendDueCampaignSteps());
  setInterval(() => {
    sendScheduledEmails().catch((err) => console.error('Scheduled send failed:', err));
    campaignTick().catch((err) => console.error('Campaign send failed:', err));
  }, 60_000);
}

export default app;
