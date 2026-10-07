import { Router } from 'express';
import { requireOwner } from '../auth/middleware.js';
import { getIntegrationsStore } from '../storage/integrations.js';
import { resolveVercelCredentials } from '../integrations/resolve.js';
import { createVercelTeam, vercelProvisionMode } from '../integrations/vercel.js';
import type { WorkspaceIntegrationsUpdate } from '../storage/integrations-types.js';

const router = Router();

router.get('/admin/integrations', requireOwner, async (_req, res) => {
  try {
    const store = await getIntegrationsStore();
    res.json(await store.getStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load integrations' });
  }
});

router.put('/admin/integrations', requireOwner, async (req, res) => {
  try {
    const patch = req.body as WorkspaceIntegrationsUpdate;
    const store = await getIntegrationsStore();
    const status = await store.update(patch);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save integrations' });
  }
});

/** Tells the admin UI whether to offer Vercel Team provisioning and the current team. */
router.get('/admin/vercel/provisioning', requireOwner, async (_req, res) => {
  try {
    const { token, teamId } = await resolveVercelCredentials();
    res.json({ mode: vercelProvisionMode(), hasToken: Boolean(token), teamId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load Vercel config' });
  }
});

/**
 * Provision a new Vercel Team for this workspace and store its id so future publishes
 * deploy into it. Only available in platform mode; BYO installs paste a team id instead.
 */
router.post('/admin/vercel/provision-team', requireOwner, async (req, res) => {
  try {
    if (vercelProvisionMode() !== 'platform') {
      res.status(403).json({
        error:
          'Team provisioning is disabled (VERCEL_PROVISION_MODE is not "platform"). Paste an existing Vercel team id instead.',
      });
      return;
    }

    const { name, slug } = req.body as { name?: string; slug?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'A team name is required' });
      return;
    }

    const { token } = await resolveVercelCredentials();
    if (!token) {
      res.status(400).json({ error: 'Set a Vercel token first (Integrations → Vercel).' });
      return;
    }

    const team = await createVercelTeam(token, { name: name.trim(), slug });
    const store = await getIntegrationsStore();
    await store.update({ vercelTeamId: team.id });

    res.status(201).json({ teamId: team.id, slug: team.slug, name: team.name });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to provision Vercel team' });
  }
});

router.get('/admin/openrouter/models', requireOwner, async (_req, res) => {
  try {
    const store = await getIntegrationsStore();
    const apiKey = (await store.getSecret('openrouter_api_key')) ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'OpenRouter API key not configured' });
      return;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      res.status(502).json({ error: `OpenRouter API error: ${response.status}` });
      return;
    }

    const data = (await response.json()) as {
      data?: Array<{ id: string; name?: string }>;
    };
    const models = (data.data ?? []).map((m) => ({ id: m.id, name: m.name ?? m.id }));
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch models' });
  }
});

export default router;
