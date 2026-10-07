import type { EmailProviderId, SiteEmailSettings, SiteEmailSettingsUpdate } from '../api';

/** EmailSetupWizard's connect-step fields, as typed (untrimmed). */
export interface EmailWizardForm {
  provider: EmailProviderId;
  resendApiKey: string;
  apiKey: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  notifyEmail: string;
  /** Owner ticked "Turn email on" (only offered when a configured site has email off). */
  turnOn: boolean;
}

/**
 * Whether the server already holds an API key for `provider`. hasApiKey only describes
 * the ACTIVE provider (and SendGrid/Postmark share one slot), so a key saved for another
 * provider never counts.
 */
export function hasSavedApiKey(provider: EmailProviderId, saved: SiteEmailSettings | undefined): boolean {
  return saved?.provider === provider && !!saved.hasApiKey;
}

/**
 * Validate the wizard's connect step and build the PUT /email body. The wizard opens
 * prefilled from `saved`, so sending those fields back only changes what the owner
 * edited. A blank secret means "keep the saved one" and is only accepted when the
 * server already has it for this provider.
 */
export function buildWizardSave(
  form: EmailWizardForm,
  saved: SiteEmailSettings | undefined
): { body: SiteEmailSettingsUpdate } | { error: string } {
  const fromEmail = form.fromEmail.trim();
  if (!fromEmail) return { error: 'A from email is required' };

  const { provider } = form;
  const body: SiteEmailSettingsUpdate = {
    provider,
    fromEmail,
    fromName: form.fromName.trim(),
    notifyEmail: form.notifyEmail.trim() || fromEmail,
  };
  // First-time setup turns email on. Re-running on a configured site keeps the saved
  // on/off choice unless the owner explicitly ticks "Turn email on".
  if (!saved?.hasApiKey || form.turnOn) body.enabled = true;

  if (provider === 'smtp') {
    const host = form.smtpHost.trim();
    const username = form.smtpUsername.trim();
    if (!host) return { error: 'SMTP host is required' };
    // No username = unauthenticated relay. The SMTP password has its own slot, so a saved one counts.
    if (username && !form.smtpPassword.trim() && !saved?.smtp?.hasPassword) {
      return { error: 'Enter the SMTP password' };
    }
    body.smtp = {
      host,
      ...(form.smtpPort.trim() ? { port: Number(form.smtpPort.trim()) } : {}),
      secure: form.smtpSecure,
      username,
      ...(form.smtpPassword.trim() ? { password: form.smtpPassword } : {}),
    };
    return { body };
  }

  const key = (provider === 'resend' ? form.resendApiKey : form.apiKey).trim();
  if (!key && !hasSavedApiKey(provider, saved)) {
    const label = { resend: 'Resend API key', sendgrid: 'SendGrid API key', postmark: 'Postmark server API token' }[
      provider
    ];
    return { error: `Enter your ${label}` };
  }
  if (key && provider === 'resend') body.resendApiKey = key;
  else if (key) body.apiKey = key;
  return { body };
}

const MAILBOXES_ONLY_KEY = 'freshpress_email_mailboxes_only';

/** Per-browser memory of "I only need mailboxes", so the wizard stops auto-opening for that site. */
export function choseMailboxesOnly(siteId: string): boolean {
  try {
    return localStorage.getItem(`${MAILBOXES_ONLY_KEY}:${siteId}`) === '1';
  } catch {
    return false;
  }
}

export function rememberMailboxesOnly(siteId: string): void {
  try {
    localStorage.setItem(`${MAILBOXES_ONLY_KEY}:${siteId}`, '1');
  } catch {
    // Storage blocked (private mode, policy) — the wizard just auto-opens again next visit.
  }
}
