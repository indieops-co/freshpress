/** Boot-time validation for vendor-hosted CMS instances (HOSTED=1). */
export function validateHostedProfile(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.HOSTED !== '1') return;

  // Demo mode: MASTER_KEY is not required — the demo session endpoint handles auth
  const isDemo = process.env.DEMO_MODE === '1';

  const missing: string[] = [];
  if (!isDemo && !process.env.MASTER_KEY) missing.push('MASTER_KEY');
  if (!process.env.MONGODB_URI) missing.push('MONGODB_URI');
  if (!process.env.APP_URL) missing.push('APP_URL');

  if (missing.length > 0) {
    throw new Error(
      `HOSTED=1 requires: ${missing.join(', ')}. See docs/HOSTED-INSTANCE.md`
    );
  }

  if (!process.env.DATA_DIR) {
    console.warn('[FreshPress] HOSTED=1: set DATA_DIR=/data with a mounted volume for publishes and media.');
  }
}
