/**
 * Marketing site gate — decides whether this instance serves the public
 * FreshPress marketing page at '/'.
 *
 * Default ON for the demo instance (that's where the "Try the live demo"
 * CTA lands), OFF everywhere else — buyer and self-hosted instances must
 * never show FreshPress marketing at their root. MARKETING_SITE=1 forces
 * it on (marketing-only instance); MARKETING_SITE=0 forces it off (demo
 * without marketing).
 */

export function marketingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MARKETING_SITE === '1') return true;
  if (env.MARKETING_SITE === '0') return false;
  return env.DEMO_MODE === '1';
}
