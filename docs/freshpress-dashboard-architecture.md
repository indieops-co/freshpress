# FreshPress Dashboard Architecture

## Product principle

**One sidebar, two modes: Sites Mode and Admin Mode.**

FreshPress separates two contexts:

1. **Sites Mode** — managing a selected client site (content, forms, publishes, site settings).
2. **Admin Mode** — workspace-level defaults and placeholders (billing, integrations, security).

Users should always know: *"Am I managing a client site, or am I managing FreshPress itself?"*

## Why this structure

- Client site management and workspace admin are different mental models.
- Avoid multiple competing sidebars (no second permanent "site settings" sidebar).
- Keep site-specific settings under **Selected Site → Settings**.
- Keep workspace defaults under **Admin Mode**.

## Sites Mode

- **Site list** in the left sidebar (search + select).
- **Selected site navigation** in the same sidebar:
  - Overview
  - Editor
  - Pages
  - Media
  - Forms
  - Blog
  - SEO
  - Publishes
  - Snapshots
  - Settings
- **Admin Settings** button at the bottom switches to Admin Mode.

## Editor focus workspace

The **Editor** is not a normal dashboard page. Selecting **Editor** opens a full-screen focused editing workspace (slot editing + preview). The dashboard sidebar collapses to a slim rail in editor focus mode.

Return via **Back to Overview** or sidebar navigation.

## Admin Mode

- **Back to Sites** returns to Sites Mode.
- Admin navigation:
  - Workspace
  - Users
  - Client Access
  - Integrations
  - Email (workspace defaults placeholder — per-site delivery lives in Site Settings → Email)
  - AI Providers
  - Billing
  - Defaults
  - Security

Admin screens are mostly placeholders in the first dashboard sprint. Do not mix client editing tools into Admin Mode.

## Email and forms split

| Surface | Purpose |
|---------|---------|
| **Forms** | Form enabled/disabled, notify email, success message, submissions inbox, embed snippet |
| **Site Settings → Email** | Per-site email provider BYOK: Resend, SendGrid, Postmark or SMTP (source of truth for delivery) |
| **Site Settings → Access** | Client password and invite |
| **Admin → Email** | Workspace defaults placeholder (not source of truth yet) |

## Sidebar visual rule

The sidebar must stand out from the main content:

- When body background is dark (`--bg`), sidebar uses a **darker** token (`--sidebar-bg`).
- If body were pure black, sidebar would be **lighter** (`--surface`).

Active site and nav items use a subtle `--accent` indicator.

## Do not create

- A second permanent site settings sidebar.
- Global settings mixed into site-level Settings.
- Client editing tools inside Admin Mode.

## State

`DashboardProvider` holds:

- `selectedSiteId`, `sidebarMode`, `activeSiteSection`, `activeAdminSection`, `sidebarCollapsed`

Persisted in `localStorage` (`freshpress_dashboard`) with validated defaults. Legacy key `presspal_dashboard` is migrated on read.

## Future

- Breadcrumbs
- Command palette
- Agency-wide bulk updates
- Mobile drawer behavior (initial responsive collapse implemented)
