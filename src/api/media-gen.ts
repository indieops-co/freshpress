import { Router } from 'express';
import { requireOwner } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { resolveAgentMediaKey } from '../integrations/resolve.js';
import { formatDesignRulesBlock } from '../design/design-excellence.js';
import type { StyleGuide } from '../design/style-guide.js';

const AGENT_MEDIA_BASE = 'https://api.agent-media.ai/v1';

const router = Router();

// ─── Prompt grounding ────────────────────────────────────────────────────────

/**
 * Injects the site's StyleGuide into an image prompt so every generated asset
 * is grounded in the brand — the key differentiator vs generic AI image tools.
 * The brand's designRules (whose Agent Prompt Guide section targets exactly
 * this case) ride along as their own labeled block — not inside the Mood
 * clause, where a multi-line rules list would be mislabeled as mood.
 */
export function buildGroundedImagePrompt(userPrompt: string, guide: StyleGuide): string {
  const c = guide.colors;
  const t = guide.typography;
  const mood = guide.meta.aesthetic;
  const philosophy = guide.meta.designPhilosophy;

  return [
    userPrompt,
    `Brand aesthetic: ${mood}.`,
    `Design philosophy: ${philosophy}`,
    `Color palette: primary ${c.primary}, accent ${c.accent}, background ${c.background}.`,
    `Typography feel: ${t.headingFont} headings, ${t.bodyFont} body.`,
    `Motion style: ${guide.motion.style}. Mood: ${guide.aiSystemPromptAddition}`,
    formatDesignRulesBlock(guide.designRules),
  ]
    .filter(Boolean)
    .join(' ');
}

function buildGroundedVideoPrompt(description: string, guide: StyleGuide): string {
  return `${description}. Visual style: ${guide.meta.aesthetic}. Brand mood: ${guide.meta.designPhilosophy}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function agentMediaPost(
  path: string,
  body: Record<string, unknown>,
  apiKey: string
): Promise<Response> {
  return fetch(`${AGENT_MEDIA_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function agentMediaGet(path: string, apiKey: string): Promise<Response> {
  return fetch(`${AGENT_MEDIA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /sites/:siteId/media/generate-image
 * Generate a single brand-grounded portrait/image via agent-media make_portrait.
 */
router.post('/sites/:siteId/media/generate-image', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { prompt, style } = req.body as { prompt?: string; style?: string };

    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const apiKey = await resolveAgentMediaKey();
    if (!apiKey) {
      res.status(400).json({ error: 'Agent Media API key not configured. Add it in Admin → Integrations.' });
      return;
    }

    const store = await getStyleGuideStore();
    const guide = await store.get(siteId);
    const groundedPrompt = guide ? buildGroundedImagePrompt(prompt, guide) : prompt;

    const response = await agentMediaPost('/skills/make_portrait/run', {
      description: groundedPrompt,
      ...(style ? { realism_preset: style } : {}),
    }, apiKey);

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: `Agent Media error: ${err}` });
      return;
    }

    const data = await response.json() as { run_id?: string; skill_run_id?: string };
    const jobId = data.run_id ?? data.skill_run_id;
    res.json({ jobId, groundedPrompt });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Image generation failed' });
  }
});

/**
 * GET /sites/:siteId/media/generate-image/:jobId
 * Poll the status of a make_portrait job.
 */
router.get('/sites/:siteId/media/generate-image/:jobId', requireOwner, async (req, res) => {
  try {
    const jobId = routeParam(req.params.jobId);

    const apiKey = await resolveAgentMediaKey();
    if (!apiKey) {
      res.status(400).json({ error: 'Agent Media API key not configured' });
      return;
    }

    const response = await agentMediaGet(`/primitives/runs/${jobId}`, apiKey);
    if (!response.ok) {
      res.status(502).json({ error: `Agent Media poll error: ${response.status}` });
      return;
    }

    const data = await response.json() as {
      status?: string;
      final_output?: { portrait_url?: string };
      artifacts?: Array<{ url: string }>;
    };

    const imageUrl =
      data.final_output?.portrait_url ??
      data.artifacts?.[0]?.url ??
      null;

    res.json({ status: data.status, imageUrl });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Poll failed' });
  }
});

/**
 * POST /sites/:siteId/media/generate-video
 * Start an end-to-end UGC video via agent-media make_ugc_video.
 */
router.post('/sites/:siteId/media/generate-video', requireOwner, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const {
      description,
      script,
      duration = 10,
      subtitles = true,
    } = req.body as {
      description?: string;
      script?: string;
      duration?: number;
      subtitles?: boolean;
    };

    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }
    if (!script) {
      res.status(400).json({ error: 'script is required' });
      return;
    }

    const apiKey = await resolveAgentMediaKey();
    if (!apiKey) {
      res.status(400).json({ error: 'Agent Media API key not configured. Add it in Admin → Integrations.' });
      return;
    }

    const store = await getStyleGuideStore();
    const guide = await store.get(siteId);
    const groundedDescription = guide
      ? buildGroundedVideoPrompt(description, guide)
      : description;

    const response = await agentMediaPost('/skills/make_ugc_video/run', {
      description: groundedDescription,
      script,
      duration,
      subtitles,
    }, apiKey);

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: `Agent Media error: ${err}` });
      return;
    }

    const data = await response.json() as { skill_run_id?: string; run_id?: string };
    const jobId = data.skill_run_id ?? data.run_id;
    res.json({ jobId, groundedDescription });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Video generation failed' });
  }
});

/**
 * GET /sites/:siteId/media/generate-video/:jobId
 * Poll the status of a make_ugc_video job.
 */
router.get('/sites/:siteId/media/generate-video/:jobId', requireOwner, async (req, res) => {
  try {
    const jobId = routeParam(req.params.jobId);

    const apiKey = await resolveAgentMediaKey();
    if (!apiKey) {
      res.status(400).json({ error: 'Agent Media API key not configured' });
      return;
    }

    const response = await agentMediaGet(`/skills/runs/${jobId}`, apiKey);
    if (!response.ok) {
      res.status(502).json({ error: `Agent Media poll error: ${response.status}` });
      return;
    }

    const data = await response.json() as {
      status?: string;
      final_output?: { video_url?: string };
    };

    res.json({ status: data.status, videoUrl: data.final_output?.video_url ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Poll failed' });
  }
});

/**
 * GET /sites/:siteId/media/generate-status
 * Returns whether agent-media is configured for this workspace.
 */
router.get('/sites/:siteId/media/generate-status', requireOwner, async (_req, res) => {
  const apiKey = await resolveAgentMediaKey();
  res.json({ configured: !!apiKey });
});

export default router;
