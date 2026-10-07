import type { AiCredentials } from './chat.js';

/**
 * One plain-text completion call to the configured provider (no JSON response
 * forcing). Same provider/truncation handling as callAiJson — the text-mode
 * callers (DESIGN.md authoring) previously hand-rolled this dance and drifted:
 * only one provider branch had a truncation guard.
 */
export async function callAiText(
  system: string,
  user: string,
  credentials: AiCredentials,
  opts: { maxTokens?: number } = {}
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 1024;
  if (credentials.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': credentials.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credentials.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };
    if (data.stop_reason === 'max_tokens') {
      throw new Error(`AI response was truncated at the ${maxTokens}-token limit — retry with shorter inputs or a larger budget`);
    }
    return data.content?.find((c) => c.type === 'text')?.text ?? '';
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3001',
      'X-Title': 'FreshPress',
    },
    body: JSON.stringify({
      model: credentials.model ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error('AI response was truncated at the token limit — retry with shorter inputs or a larger budget');
  }
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * One JSON-completion call to the configured provider. Returns raw text — parsing
 * is the (pure, testable) caller's job. Shared by the generators and the brand
 * extractor, which previously carried byte-identical copies of this fetch dance.
 */
export async function callAiJson(
  system: string,
  user: string,
  credentials: AiCredentials,
  opts: { maxTokens?: number } = {}
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 1024;
  if (credentials.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': credentials.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credentials.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };
    // A truncated 200 otherwise surfaces downstream as a baffling "invalid JSON" parse error.
    if (data.stop_reason === 'max_tokens') {
      throw new Error(`AI response was truncated at the ${maxTokens}-token limit — retry with shorter inputs or a larger budget`);
    }
    return data.content?.find((c) => c.type === 'text')?.text ?? '';
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3001',
      'X-Title': 'FreshPress',
    },
    body: JSON.stringify({
      model: credentials.model ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error('AI response was truncated at the token limit — retry with shorter inputs or a larger budget');
  }
  return data.choices?.[0]?.message?.content ?? '';
}

/** Balanced {…}/[…] span starting exactly at `start`, or null. */
function balancedSpanAt(raw: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Runaway guard: AI responses hold one value plus prose, never 50 candidates. */
const MAX_SCAN_CANDIDATES = 50;

/**
 * What the caller expects the response's JSON payload to be. Declaring it
 * disambiguates prose brackets from data: in "See [1] for details: {…}" the
 * "[1]" IS valid JSON, and only the caller knows an array isn't its answer.
 */
export type ExpectedJson = 'object' | 'array' | 'any';

function matchesExpectation(span: string, expect: ExpectedJson): boolean {
  try {
    const value = JSON.parse(span) as unknown;
    if (expect === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    if (expect === 'array') return Array.isArray(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * First candidate in `raw` that parses as the expected shape (prose brackets
 * like "[1]" or a markdown link either fail JSON.parse or fail the shape
 * check, so the scan moves past them); `fallback` keeps the first
 * balanced-but-unparseable span so callers that report "invalid JSON" (vs
 * "no JSON") can still distinguish the two.
 */
function scanForJson(raw: string, expect: ExpectedJson): { parsed: string | null; fallback: string | null } {
  let fallback: string | null = null;
  let from = 0;
  for (let n = 0; n < MAX_SCAN_CANDIDATES; n++) {
    const iBrace = raw.indexOf('{', from);
    const iBracket = raw.indexOf('[', from);
    const start = iBrace === -1 ? iBracket : iBracket === -1 ? iBrace : Math.min(iBrace, iBracket);
    if (start === -1) break;
    const span = balancedSpanAt(raw, start);
    if (span !== null) {
      if (matchesExpectation(span, expect)) return { parsed: span, fallback };
      try {
        JSON.parse(span);
        // Valid JSON of the wrong shape — skip it, it's not the payload.
      } catch {
        if (fallback === null) fallback = span;
      }
    }
    from = start + 1;
  }
  return { parsed: null, fallback };
}

/**
 * The first JSON value of the expected shape in an AI response, as a raw
 * substring. Fenced blocks are preferred (any fence whose content matches),
 * then the whole text is scanned; every candidate is parse-validated so
 * neither prose brackets ("[1]", markdown links), trailing braces, nor a
 * brace-y code fence ahead of the real ```json fence can hijack the match —
 * the failure modes of the greedy `/\{[\s\S]*\}/` idiom this replaces. When
 * nothing matches, the first balanced-but-unparseable span is returned so
 * callers can report "invalid JSON" rather than "no JSON". Use this (or
 * extractJsonValue) for all new AI-response parsing.
 */
export function extractJsonSlice(raw: string, expect: ExpectedJson = 'any'): string | null {
  let fallback: string | null = null;
  for (const m of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fence = scanForJson(m[1], expect);
    if (fence.parsed !== null) return fence.parsed;
    if (fallback === null) fallback = fence.fallback;
  }
  const whole = scanForJson(raw, expect);
  return whole.parsed ?? fallback ?? whole.fallback;
}

/** extractJsonSlice, parsed — null on no candidate OR invalid JSON. */
export function extractJsonValue(raw: string, expect: ExpectedJson = 'any'): unknown {
  const slice = extractJsonSlice(raw, expect);
  if (slice === null) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
