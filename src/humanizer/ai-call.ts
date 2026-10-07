import { resolveAiKeys } from '../integrations/resolve.js';
import { callAiText } from '../ai/call-json.js';

/**
 * Raw single-turn text completion via whichever AI provider is configured
 * (BYOK) for this workspace. Delegates to the shared callAiText — it finds
 * the text block instead of assuming content[0] (newer Anthropic models can
 * lead with non-text blocks), throws on truncation, and enforces maxTokens
 * on both providers.
 */
export async function callAi(system: string, user: string, maxTokens: number): Promise<string> {
  const ai = await resolveAiKeys();
  if (!ai) throw new Error('No AI provider configured');
  return callAiText(system, user, ai, { maxTokens });
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json|html)?\s*([\s\S]*?)```$/i);
  return fence ? fence[1].trim() : trimmed;
}
