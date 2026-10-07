import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HumanizerManifest } from './types.js';

const SKILLS_DIR = join(process.cwd(), 'ref', 'skills', 'humanizer');

export const UPSTREAM_SKILL_PATH = join(SKILLS_DIR, 'upstream-SKILL.md');
export const AUGMENT_SKILL_PATH = join(SKILLS_DIR, 'augment-SKILL.md');
export const MANIFEST_PATH = join(SKILLS_DIR, 'manifest.json');

const UPSTREAM_URL =
  'https://raw.githubusercontent.com/blader/humanizer/main/SKILL.md';

/** Strip YAML frontmatter from skill markdown. */
export function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw.trim();
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw.trim();
  return raw.slice(end + 4).trim();
}

export async function loadUpstreamSkill(): Promise<string> {
  const raw = await readFile(UPSTREAM_SKILL_PATH, 'utf-8');
  return stripFrontmatter(raw);
}

export async function loadAugmentSkill(): Promise<string> {
  return readFile(AUGMENT_SKILL_PATH, 'utf-8');
}

export async function loadManifest(): Promise<HumanizerManifest> {
  const raw = await readFile(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw) as HumanizerManifest;
}

export async function syncUpstreamSkill(): Promise<HumanizerManifest> {
  const res = await fetch(UPSTREAM_URL);
  if (!res.ok) throw new Error(`Failed to fetch upstream skill: ${res.status}`);
  const content = await res.text();
  await writeFile(UPSTREAM_SKILL_PATH, content, 'utf-8');

  const versionMatch = content.match(/^version:\s*([^\n]+)/m);
  const version = versionMatch?.[1]?.trim() ?? 'unknown';
  const manifest: HumanizerManifest = {
    repo: 'https://github.com/blader/humanizer',
    upstreamPath: 'SKILL.md',
    version,
    syncedAt: new Date().toISOString(),
    changelog: [
      ...(await loadManifest().then((m) => m.changelog ?? []).catch(() => [])),
      { date: new Date().toISOString().slice(0, 10), note: `Synced upstream v${version}` },
    ].slice(-20),
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}
