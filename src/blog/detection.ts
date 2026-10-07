import { resolveSecret } from '../integrations/resolve.js';

export interface DetectionResult {
  score: number;
  provider: string;
  note?: string;
}

/** BYOK AI detection via Originality.ai when key configured; heuristic fallback otherwise. */
export async function detectAiContent(text: string): Promise<DetectionResult> {
  const key = await resolveSecret('originality_ai_api_key');
  const plain = text.replace(/<[^>]+>/g, ' ').trim();

  if (key) {
    try {
      const res = await fetch('https://api.originality.ai/api/v1/scan/ai', {
        method: 'POST',
        headers: {
          'X-OAI-API-KEY': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: plain, title: 'FreshPress blog post' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { score?: number };
        return { score: data.score ?? 0, provider: 'originality.ai' };
      }
    } catch {
      // fall through
    }
  }

  const avgSentence = plain.split(/[.!?]+/).filter(Boolean).length;
  const heuristic = Math.min(95, Math.max(5, 40 + (plain.length > 2000 ? 15 : 0) + (avgSentence < 4 ? 10 : 0)));
  return {
    score: heuristic,
    provider: 'heuristic',
    note: 'Add Originality.ai key in Admin → Integrations for real detection.',
  };
}
