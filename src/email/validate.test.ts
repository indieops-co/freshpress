import { describe, it, expect } from 'vitest';
import { ContactFormSchema, EmailSettingsSchema, validateEmailConfig } from '../email/validate.js';
import { maskApiKey } from '../email/send.js';

describe('email validation', () => {
  it('validates contact form', () => {
    const result = ContactFormSchema.safeParse({
      name: 'Jane',
      email: 'jane@example.com',
      message: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email settings', () => {
    expect(EmailSettingsSchema.safeParse({ fromEmail: 'not-an-email' }).success).toBe(false);
  });

  it('masks api keys', () => {
    expect(maskApiKey('re_1234567890abcdef')).toBe('••••••••cdef');
  });

  it('rejects enabled form without notification email', () => {
    const result = validateEmailConfig({ enabled: true });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Notification email');
  });

  it('rejects script content in success message', () => {
    const result = validateEmailConfig({
      enabled: true,
      notifyEmail: 'inbox@example.com',
      successMessage: '<script>alert(1)</script>',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Success message');
  });

  it('accepts valid form config', () => {
    const result = validateEmailConfig({
      enabled: true,
      notifyEmail: 'inbox@example.com',
      successMessage: 'Thanks for reaching out!',
    });
    expect(result.ok).toBe(true);
  });
});
