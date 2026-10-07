/** Provisioning mode for client-site hosting on Vercel. */
export type VercelProvisionMode = 'platform' | 'byo';

/**
 * How this instance treats Vercel:
 * - 'byo'      (default) — the agency pastes their own token + team id; we never create teams.
 * - 'platform' — we own the Vercel account and provision a Team per agency via the API.
 */
export function vercelProvisionMode(): VercelProvisionMode {
  return process.env.VERCEL_PROVISION_MODE === 'platform' ? 'platform' : 'byo';
}

/** Vercel team slugs are lowercase alphanumeric + hyphens. */
export function slugifyTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'team';
}

export interface CreatedVercelTeam {
  id: string;
  slug: string;
  name?: string;
}

/**
 * Create a new Vercel Team under the account that owns `token`.
 * Mirrors the fetch/auth shape of deployToVercel. Throws with the Vercel error body on failure.
 */
export async function createVercelTeam(
  token: string,
  opts: { name: string; slug?: string }
): Promise<CreatedVercelTeam> {
  const slug = opts.slug?.trim() ? slugifyTeamName(opts.slug) : slugifyTeamName(opts.name);
  const res = await fetch('https://api.vercel.com/v1/teams', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slug, name: opts.name }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vercel team create failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { id: string; slug?: string; name?: string };
  return { id: data.id, slug: data.slug ?? slug, name: data.name };
}
