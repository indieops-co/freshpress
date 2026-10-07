# Email on FreshPress

FreshPress replaces the email jobs a WordPress host does for a small-business site — and adds some a WordPress host never did. This guide explains what's built in, how it compares, and how to set up the two kinds of email every business needs.

## The two kinds of email

1. **Site email** — email your *website* sends and receives: contact-form notifications, newsletter signups and campaigns, and an inbox for addresses like `hello@yourdomain.com`. **Built into FreshPress Pro.**
2. **Business mailboxes** — your personal work email, read in Apple Mail or the Gmail app on your phone. **No website platform should reinvent this** — use a mailbox provider (below).

FreshPress gives you the first kind natively and recommends best-in-class providers for the second — the same split premium WordPress hosts use, except they only give you the recommendation.

## How this compares to WordPress hosting

|  | Budget cPanel hosts (Bluehost etc.) | Managed WP hosts (WP Engine, Kinsta) | FreshPress Pro + Vercel |
|---|---|---|---|
| Business mailboxes | POP/IMAP included (often poor deliverability) | Not offered; they point you to Google Workspace | Same recommendation: Google Workspace / Zoho |
| Contact-form email | PHP `mail()` (frequently lands in spam) | Requires an SMTP plugin + third-party service | Built in, via your own provider account |
| Newsletter signups + campaigns | Plugins | Plugins | Built in (double opt-in, sequences, one-click unsubscribe) |
| Site inbox in your dashboard | cPanel webmail | Not offered | Built in (with the Resend provider) |
| Signup automation triggers | Plugins | Plugins | Built in (signed webhooks to Zapier/CRM/any tool) |

## Path A — Site email (built in, Pro plan)

Open **Site Settings → Email** and the setup wizard walks you through it: pick a provider, paste your credentials, verify with a test send. You bring your own provider account (BYOK) — FreshPress never resells or marks up email.

| Provider | Sending | Built-in inbox | Notes |
|---|---|---|---|
| **Resend** (recommended) | ✓ | ✓ | Free tier covers most sites. The only provider that powers the FreshPress inbox, receiving, and domain setup. |
| SendGrid | ✓ | — | Use an existing account; outbound only. |
| Postmark | ✓ | — | Use an existing server token; outbound only. |
| SMTP (any account) | ✓ | — | Advanced: send through Google Workspace, Zoho, or any mailbox via SMTP credentials. |

Whichever provider you choose, verify your sending domain with them (they'll give you SPF and DKIM DNS records) before real traffic — that's what keeps your email out of spam. Each provider's dashboard walks you through its records.

What site email powers once connected:

- **Contact forms** — visitor messages stored in your dashboard and forwarded to your notification address.
- **Signups** — newsletter forms with double opt-in (visitors confirm by email before they count).
- **Campaigns** — automated email sequences, in two kinds. *Blog campaigns*, one per blog pillar: people who sign up on that pillar's page or one of its posts are enrolled once they confirm. An optional *welcome campaign*, one per site, catches everyone else: confirmed signups that no active blog campaign picks up — your homepage, a landing page, your contact page, or a pillar without an active campaign — get its short welcome sequence instead. FreshPress drafts that sequence from what your site says about your business (or starts you from a simple template), and you can edit every email before turning it on. Without a welcome campaign, those signups join your subscriber list but no sequence. Every email has compliant one-click unsubscribe.
- **Signup webhooks** — signed notifications to any URL when someone subscribes or unsubscribes, for wiring up Zapier, a CRM, or an outreach tool.
- **Site inbox** (Resend only) — send and receive at your own addresses from the FreshPress dashboard, with folders and branded compose.

## Path B — Business mailboxes

For Gmail-style mail on your phone, use a mailbox provider on your domain:

- **Google Workspace** — the default choice; ~$7/user/month.
- **Zoho Mail** — solid low-cost alternative with a free tier for small teams.

Both take about ten minutes: add your domain, prove ownership with a DNS record, add the MX records they give you, create your users.

### Using both at once (recommended setup)

A domain's incoming mail can only go to **one** place — MX records are exclusive. The clean way to have both:

- **`yourdomain.com`** → MX points at Google Workspace / Zoho. Your personal mailboxes live here (`you@yourdomain.com`).
- **`mail.yourdomain.com`** → set up as the FreshPress inbound domain (choose "subdomain" in Site Settings → Inbound Email). The site inbox lives here (`hello@mail.yourdomain.com`).
- **Outbound site email** is unaffected either way — SPF/DKIM records for your sending provider coexist fine with mailbox MX records.

If you don't need the built-in inbox, there's nothing to coordinate: mailboxes own the domain's MX, and FreshPress just sends.

## FAQ

**Can I read the FreshPress site inbox in Apple Mail / the Gmail app?**
No — it lives in your FreshPress dashboard (there's no IMAP). If phone-native mail matters for an address, put it on your mailbox provider instead, and keep the site inbox for site traffic.

**Do I need a paid plan for email?**
The email system (delivery settings, signups, campaigns, inbox) is a Pro-tier feature of FreshPress. The provider account is yours: Resend's free tier is enough for most small sites.

**Why did my campaign email land in spam?**
Almost always missing SPF/DKIM — finish domain verification in your provider's dashboard. Campaign sends already include the one-click unsubscribe headers Gmail and Yahoo require of bulk senders.

**Can signups trigger my CRM or outreach tool?**
Yes — add a signup webhook (Forms page). FreshPress POSTs a signed JSON payload on every confirm/unsubscribe, with the event name in `X-FreshPress-Event`. To verify it, compute the HMAC-SHA256 of the raw request body using the secret shown when you created the webhook, hex-encode it, and compare it to `X-FreshPress-Signature`, which has the form `sha256=<hex>`.
