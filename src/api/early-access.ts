/**
 * Early Access lead capture — only active in all environments but the collection
 * only matters on the demo instance. Non-demo instances can mount this router
 * too (harmless — no leads arrive if there's no demo banner).
 *
 * POST /api/early-access  { email, source? }
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DEMO_MODE } from '../demo/middleware.js';

const router = Router();

const EarlyAccessBodySchema = z.object({
  email: z.string().email(),
  source: z.string().optional().default('demo'),
});

/** 5 submissions per IP per hour in demo mode; more lenient otherwise. */
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: DEMO_MODE ? 5 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

router.post('/early-access', limiter, async (req, res) => {
  const parsed = EarlyAccessBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }

  const { email, source } = parsed.data;
  const lead = {
    email: email.trim().toLowerCase(),
    source,
    capturedAt: new Date().toISOString(),
    ip: req.ip ?? null,
  };

  // Persist to MongoDB when available
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(mongoUri);
      await client.connect();
      const dbName = process.env.FRESHPRESS_DB_NAME ?? 'freshpress';
      const db = client.db(dbName);
      // Upsert by email so duplicate submissions don't create duplicates
      await db
        .collection('early_access_leads')
        .updateOne({ email: lead.email }, { $set: lead, $setOnInsert: { firstCapturedAt: lead.capturedAt } }, { upsert: true });
      await client.close();
    } catch (err) {
      console.error('[early-access] mongo write error:', err);
      // Don't fail the request — still return success
    }
  } else {
    // Log to console so vendor can collect from Railway logs in non-Mongo mode
    console.log('[early-access] lead:', JSON.stringify(lead));
  }

  // Optional: notify vendor via Resend
  const notifyEmail = process.env.RESEND_EARLY_ACCESS_NOTIFY;
  const resendKey = process.env.RESEND_API_KEY;
  if (notifyEmail && resendKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'FreshPress Demo <noreply@freshpress.dev>',
          to: notifyEmail,
          subject: `New Early Access lead: ${lead.email}`,
          text: `Source: ${lead.source}\nEmail: ${lead.email}\nCaptured: ${lead.capturedAt}`,
        }),
      });
    } catch {
      // Notification failure is non-fatal
    }
  }

  res.json({ ok: true });
});

export default router;
