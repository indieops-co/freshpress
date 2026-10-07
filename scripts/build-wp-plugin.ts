#!/usr/bin/env npx tsx
/**
 * Build a distributable zip of the FreshPress Connector WordPress plugin.
 *
 * The version comes from the plugin header (single source of truth); the output is
 * dist/freshpress-connector-<ver>.zip, unzipping to a `freshpress-connector/` folder
 * ready to drop into wp-content/plugins/. Only distributable files ship (source .php,
 * readme.txt, templates) — dotfiles and other cruft are excluded. Builds are
 * deterministic: entries are sorted and stamped with a fixed date, so re-running
 * produces a byte-identical archive.
 *
 * Usage: npm run build:wp-plugin
 */
import { createWriteStream } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
// This archiver build is ESM with named class exports (no default/factory).
// @ts-expect-error — the package ships no type declarations.
import { ZipArchive } from 'archiver';

interface Archive {
  pipe(dest: NodeJS.WritableStream): void;
  append(source: Buffer, data: { name: string; date?: Date }): void;
  finalize(): Promise<void>;
  on(event: 'warning' | 'error', cb: (err: unknown) => void): void;
}

const PLUGIN_DIR = join(process.cwd(), 'wp-plugin', 'freshpress-connector');
const OUT_DIR = join(process.cwd(), 'dist');
const PLUGIN_SLUG = 'freshpress-connector';
// Fixed timestamp for every entry — the input is the same, so the output should be too.
const FIXED_DATE = new Date('2020-01-01T00:00:00Z');
// Extensions that ship. Anything else (dotfiles, .DS_Store, build junk) is left out.
const DIST_EXT = new Set(['.php', '.txt', '.css', '.js', '.png', '.jpg', '.svg', '.mo', '.po', '.pot']);

async function readVersion(): Promise<string> {
  const header = await readFile(join(PLUGIN_DIR, `${PLUGIN_SLUG}.php`), 'utf-8');
  const m = header.match(/^\s*\*\s*Version:\s*([0-9][^\s]*)/m);
  if (!m) throw new Error('Could not find a "Version:" line in the plugin header.');
  return m[1];
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(full)));
    else if (DIST_EXT.has(extname(entry.name))) out.push(full);
  }
  return out.sort();
}

async function main(): Promise<void> {
  const version = await readVersion();
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${PLUGIN_SLUG}-${version}.zip`);
  const files = await collectFiles(PLUGIN_DIR);
  if (files.length === 0) throw new Error(`No distributable files found in ${PLUGIN_DIR}`);

  const output = createWriteStream(outPath);
  const archive: Archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('warning', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  for (const file of files) {
    // Prefix with the plugin folder so it unzips to wp-content/plugins/freshpress-connector/.
    const name = join(PLUGIN_SLUG, relative(PLUGIN_DIR, file));
    archive.append(await readFile(file), { name, date: FIXED_DATE });
  }

  await archive.finalize();
  await done;
  console.log(`Built ${relative(process.cwd(), outPath)} — ${files.length} files, v${version}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
