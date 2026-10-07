import { describe, expect, it } from 'vitest';
import type { SiteEmailSettings } from '../api';
import { buildWizardSave, type EmailWizardForm } from './emailSetup';

const blankForm: EmailWizardForm = {
  provider: 'resend',
  resendApiKey: '',
  apiKey: '',
  smtpHost: '',
  smtpPort: '',
  smtpSecure: false,
  smtpUsername: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: '',
  notifyEmail: '',
  turnOn: false,
};

/** A configured site whose owner deliberately turned email off and routes contact mail elsewhere. */
const configured: SiteEmailSettings = {
  enabled: false,
  provider: 'resend',
  fromEmail: 'hello@acme.test',
  fromName: 'Acme Co',
  notifyEmail: 'owner@acme.test',
  hasApiKey: true,
  apiKeyPreview: 're_…abcd',
};

/** The wizard form as it opens on `configured` (prefilled, secrets blank). */
const prefilled: EmailWizardForm = {
  ...blankForm,
  fromEmail: 'hello@acme.test',
  fromName: 'Acme Co',
  notifyEmail: 'owner@acme.test',
};

function expectBody(result: ReturnType<typeof buildWizardSave>) {
  if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
  return result.body;
}

describe('buildWizardSave — first-time setup', () => {
  const unconfigured: SiteEmailSettings = { enabled: false, provider: 'resend' };

  it('requires a from email', () => {
    expect(buildWizardSave({ ...blankForm, resendApiKey: 're_1234567890' }, unconfigured)).toEqual({
      error: 'A from email is required',
    });
  });

  it('requires the provider credentials when none are saved', () => {
    expect(buildWizardSave({ ...blankForm, fromEmail: 'hello@acme.test' }, unconfigured)).toEqual({
      error: 'Enter your Resend API key',
    });
    expect(buildWizardSave({ ...blankForm, provider: 'postmark', fromEmail: 'a@b.test' }, undefined)).toEqual({
      error: 'Enter your Postmark server API token',
    });
  });

  it('enables email and defaults notifications to the from address', () => {
    const body = expectBody(
      buildWizardSave({ ...blankForm, fromEmail: ' hello@acme.test ', resendApiKey: ' re_1234567890 ' }, unconfigured)
    );
    expect(body).toEqual({
      provider: 'resend',
      fromEmail: 'hello@acme.test',
      fromName: '',
      notifyEmail: 'hello@acme.test',
      enabled: true,
      resendApiKey: 're_1234567890',
    });
  });
});

describe('buildWizardSave — re-run on a configured site', () => {
  it('keeps saved enabled/notify/from-name and accepts the saved key for the same provider', () => {
    const body = expectBody(buildWizardSave(prefilled, configured));
    expect(body).toEqual({
      provider: 'resend',
      fromEmail: 'hello@acme.test',
      fromName: 'Acme Co',
      notifyEmail: 'owner@acme.test',
    });
    expect(body).not.toHaveProperty('enabled');
    expect(body).not.toHaveProperty('resendApiKey');
  });

  it('turns a deliberately-off site back on only when the owner ticks it', () => {
    expect(expectBody(buildWizardSave({ ...prefilled, turnOn: true }, configured))).toMatchObject({ enabled: true });
  });

  it("does not reuse another provider's saved key when switching", () => {
    expect(buildWizardSave({ ...prefilled, provider: 'sendgrid' }, configured)).toEqual({
      error: 'Enter your SendGrid API key',
    });
    // SendGrid and Postmark share the server's apiKey slot — a saved SendGrid key is not a Postmark token.
    const onSendgrid: SiteEmailSettings = { ...configured, provider: 'sendgrid' };
    expect(buildWizardSave({ ...prefilled, provider: 'postmark' }, onSendgrid)).toEqual({
      error: 'Enter your Postmark server API token',
    });
    const body = expectBody(buildWizardSave({ ...prefilled, provider: 'sendgrid', apiKey: 'SG.12345678' }, configured));
    expect(body).toMatchObject({ provider: 'sendgrid', apiKey: 'SG.12345678', notifyEmail: 'owner@acme.test' });
    expect(body).not.toHaveProperty('enabled');
  });

  it('SMTP needs a host, and a password whenever a username is set unless one is saved', () => {
    const smtpForm: EmailWizardForm = { ...prefilled, provider: 'smtp', smtpUsername: 'me@acme.test' };
    expect(buildWizardSave({ ...smtpForm, smtpHost: '' }, configured)).toEqual({ error: 'SMTP host is required' });
    expect(buildWizardSave({ ...smtpForm, smtpHost: 'smtp.acme.test' }, configured)).toEqual({
      error: 'Enter the SMTP password',
    });

    const withSavedPassword: SiteEmailSettings = {
      ...configured,
      smtp: { host: 'smtp.acme.test', username: 'me@acme.test', hasPassword: true },
    };
    const body = expectBody(buildWizardSave({ ...smtpForm, smtpHost: 'smtp.acme.test', smtpPort: '465' }, withSavedPassword));
    expect(body.smtp).toEqual({ host: 'smtp.acme.test', port: 465, secure: false, username: 'me@acme.test' });

    // No username = unauthenticated relay, no password needed.
    expectBody(buildWizardSave({ ...smtpForm, smtpHost: 'relay.local', smtpUsername: '' }, configured));
  });
});
