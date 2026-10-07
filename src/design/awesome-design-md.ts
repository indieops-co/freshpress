import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import themesManifest from './themes-manifest.json' with { type: 'json' };

export interface ThemeManifestEntry {
  id: string;
  name: string;
  desc: string;
  aesthetic: string;
}

export function listThemes(): ThemeManifestEntry[] {
  return themesManifest as ThemeManifestEntry[];
}

/**
 * Theme DESIGN.md files are vendored into src/design/design-md/ by
 * scripts/vendor-design-md.ts — no network fetch at runtime.
 */
export async function fetchDesignMd(themeId: string): Promise<string> {
  const path = join(process.cwd(), 'src', 'design', 'design-md', `${themeId}.md`);
  try {
    return await readFile(path, 'utf-8');
  } catch {
    throw new Error(`No vendored DESIGN.md for ${themeId} — run scripts/vendor-design-md.ts`);
  }
}

const cache = new Map<string, string>();

export async function getDesignMdCached(themeId: string): Promise<string> {
  if (cache.has(themeId)) return cache.get(themeId)!;
  const raw = await fetchDesignMd(themeId);
  cache.set(themeId, raw);
  return raw;
}

export function clearDesignMdCache(): void {
  cache.clear();
}

export async function loadBundledManifest(): Promise<ThemeManifestEntry[]> {
  const path = join(process.cwd(), 'src', 'design', 'themes-manifest.json');
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as ThemeManifestEntry[];
  } catch {
    return listThemes();
  }
}

// ── Paste-a-URL themes ───────────────────────────────────────────────────────
// Any theme in the upstream awesome-design-md collection (not just the 12
// vendored ones) can be referenced by URL. The URL is normalized to an
// upstream directory id and fetched live via api.github.com — the only
// GitHub host on the approved-domains list.

const UPSTREAM_OWNER_REPO = 'VoltAgent/awesome-design-md';
const GITHUB_CONTENTS_BASE = `https://api.github.com/repos/${UPSTREAM_OWNER_REPO}/contents/design-md`;

/** Input cap for remotely fetched DESIGN.md files (largest real file ≈ 60k). */
export const REMOTE_DESIGN_MD_MAX_CHARS = 500_000;

/**
 * Manifest ids whose upstream corpus directory is named differently. The one
 * canonical mapping — the vendor script derives its fetch URLs from it, and
 * the remote path below inverts it so a pasted upstream URL (e.g. …/linear.app)
 * still hits the vendored file instead of a live GitHub fetch.
 */
export const LOCAL_ID_TO_UPSTREAM_DIR: Record<string, string> = {
  mistral: 'mistral.ai',
  linear: 'linear.app',
};

const UPSTREAM_DIR_TO_LOCAL_ID: Record<string, string> = Object.fromEntries(
  Object.entries(LOCAL_ID_TO_UPSTREAM_DIR).map(([local, upstream]) => [upstream, local])
);

/**
 * Normalize a user-pasted reference to an awesome-design-md theme into the
 * upstream directory id. Accepts:
 *   - https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/<dir>/DESIGN.md
 *   - https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/<dir>
 *   - https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<dir>/DESIGN.md
 *   - a bare directory id like "stripe" or "linear.app"
 * Returns null for anything outside the official collection.
 */
export function parseAwesomeDesignMdRef(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare directory id (no URL syntax).
  if (!/[/:]/.test(trimmed)) {
    return /^[a-z0-9][a-z0-9._-]*$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  let dirIndex: number;
  if (url.hostname === 'github.com') {
    // /VoltAgent/awesome-design-md/(blob|tree)/<ref>/design-md/<dir>[/DESIGN.md]
    if (`${parts[0]}/${parts[1]}` !== UPSTREAM_OWNER_REPO) return null;
    if (parts[2] !== 'blob' && parts[2] !== 'tree') return null;
    if (parts[4] !== 'design-md') return null;
    dirIndex = 5;
  } else if (url.hostname === 'raw.githubusercontent.com') {
    // /VoltAgent/awesome-design-md/<ref>/design-md/<dir>/DESIGN.md
    if (`${parts[0]}/${parts[1]}` !== UPSTREAM_OWNER_REPO) return null;
    if (parts[3] !== 'design-md') return null;
    dirIndex = 4;
  } else {
    return null;
  }

  const dir = parts[dirIndex];
  if (!dir || !/^[a-z0-9][a-z0-9._-]*$/i.test(dir)) return null;
  const rest = parts.slice(dirIndex + 1);
  if (rest.length > 1 || (rest.length === 1 && rest[0].toLowerCase() !== 'design.md')) return null;
  return dir.toLowerCase();
}

/** "linear.app" → "Linear", "bmw-m" → "Bmw M" — good enough for meta display. */
export function themeNameFromDirId(dirId: string): string {
  const base = dirId.replace(/\.(app|ai|com|dev|io)$/i, '');
  return base
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * DESIGN.md for a theme referenced by URL: vendored file first (covers the
 * bundled 12), then a live fetch from the official repo via api.github.com.
 */
export async function getRemoteDesignMdCached(dirId: string): Promise<string> {
  if (cache.has(dirId)) return cache.get(dirId)!;
  try {
    const local = await fetchDesignMd(UPSTREAM_DIR_TO_LOCAL_ID[dirId] ?? dirId);
    cache.set(dirId, local);
    return local;
  } catch {
    // Not vendored — fall through to the live fetch.
  }

  const response = await fetch(`${GITHUB_CONTENTS_BASE}/${dirId}/DESIGN.md`, {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'FreshPress-Design/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `No theme "${dirId}" in the awesome-design-md collection`
        : `Could not fetch DESIGN.md for ${dirId} (HTTP ${response.status})`
    );
  }
  // Real corpus files are ~30–60k chars; the cap only guards against a
  // pathological upstream file flooding the regex-scanning parsers downstream.
  const text = (await response.text()).slice(0, REMOTE_DESIGN_MD_MAX_CHARS);
  cache.set(dirId, text);
  return text;
}
