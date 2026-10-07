# HeadCheck SEO for NEXT.js apps  
  
  
Absolutely. Below is a **comprehensive build prompt series** you can feed into Cursor/Claude Code step-by-step.  
Important architecture note first: use **Supabase Email Auth** for login, then a separate **GitHub App installation flow** to access repos. GitHub Apps are better than broad OAuth/PAT access because they use fine-grained permissions, repository-level installation, and short-lived tokens. GitHub’s docs distinguish GitHub Apps from OAuth apps and note that GitHub Apps give users more control over repository access. (++[GitHub Docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps?utm_source=chatgpt.com)++) Supabase also has official Next.js App Router Auth guidance, so this stack is well-supported. (++[Supabase](https://supabase.com/docs/guides/auth/quickstarts/nextjs?utm_source=chatgpt.com)++)  
Important architecture note first: use **Supabase Email Auth** for login, then a separate **GitHub App installation flow** to access repos. GitHub Apps are better than broad OAuth/PAT access because they use fine-grained permissions, repository-level installation, and short-lived tokens. GitHub’s docs distinguish GitHub Apps from OAuth apps and note that GitHub Apps give users more control over repository access. (++[GitHub Docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps?utm_source=chatgpt.com)++) Supabase also has official Next.js App Router Auth guidance, so this stack is well-supported. (++[Supabase](https://supabase.com/docs/guides/auth/quickstarts/nextjs?utm_source=chatgpt.com)++)  
  
## HeadCheck Build Prompt Series  
**Product Summary**  
**HeadCheck** is a simple Next.js SEO checking app.  
**HeadCheck** is a simple Next.js SEO checking app.  
Users sign up with email, connect GitHub, add GitHub repo URLs, choose check frequency based on tier, and receive issue reports plus AI-agent-ready fix prompts. The MVP should **not mutate code by default**. It should be read-only for Freeloader and Founder. Agency can later enable “auto-create PRs.”  
Users sign up with email, connect GitHub, add GitHub repo URLs, choose check frequency based on tier, and receive issue reports plus AI-agent-ready fix prompts. The MVP should **not mutate code by default**. It should be read-only for Freeloader and Founder. Agency can later enable “auto-create PRs.”  
Core promise:  
**Next.js SEO checks and fix prompts you control.**  
**Next.js SEO checks and fix prompts you control.**  
Primary wedge:  
**No surprise repo writes. No auto-commits for most users. HeadCheck gives you exact snippets and Cursor/Claude-ready prompts.**  
  
## Prompt 1 — Project Foundation  
```
You are building HeadCheck, a Next.js SEO checking SaaS.

Tech stack:
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase backend
- Supabase Email Auth
- Supabase Postgres
- Supabase Row Level Security
- GitHub App integration for repository access
- Stripe later, but create subscription/tier structure now without live billing
- BYOK model for Claude or Gemini API keys
- Minimal, clean UI with white background, slate accents, and simple cards
- use this Repo for Style Guide, colors, fonts and spacing. Do not replicate the VERTICAL background gradient overlays: https://github.com/davidsparrow/fiveup

Core MVP:
Users can:
1. Sign up / log in by email.
2. Connect GitHub through a GitHub App installation.
3. Add GitHub repo URLs.
4. HeadCheck discovers the framework automatically.
5. User sees one dashboard card per connected repo URL.
6. User can run checks manually, subject to tier limits.
7. User can set check frequency based on tier.
8. User can view latest problems found.
9. User can open/copy a Fix Prompt for each issue.
10. User can store a BYOK Claude or Gemini API key.
11. The app should not write code or create PRs for Free or Founder tiers.
12. Agency tier can show an “Auto-create PRs” toggle, but implement as disabled placeholder unless the PR workflow is explicitly built later.

Tiers:
- Freeloader:
  - 1 GitHub URL
  - 1 check per month
  - No frequency slider
  - No site selector needed if only 1 site
  - BYOK required for AI-generated fix prompts
- Founder:
  - $19/mo
  - 6 GitHub URLs
  - Each URL can check max 1 time per week
  - Frequency slider: Monthly or Weekly only
  - Site selector
  - Add/Delete site
  - BYOK required
- Agency:
  - $49/mo
  - 20 GitHub URLs
  - Each URL can check max 1 time per day
  - Frequency slider: Monthly, Weekly, Daily
  - Site selector
  - Add/Delete site
  - Auto-create PRs capability planned
  - BYOK required

Design:
- Super simple dashboard.
- Top area: app name HeadCheck, user menu, tier badge.
- Main action: single GitHub URL input box.
- Add Site button.
- Subtle frequency slider/dropdown beside or under the URL box for paid users.
- Dashboard grid of cards.
- Each card:
  - Top area:
    - Last Check Date
    - # Problems Found
    - Link/button to Fix Prompt
    - GitHub logo link to repo
  - Bottom footer strip:
    - Slate background
    - GitHub URL in white text
- Use rounded cards, soft shadows, lots of whitespace.
- Do not overbuild navigation.

Build the initial Next.js project structure:
- app/
- components/
- lib/
- types/
- server actions or route handlers
- Supabase client/server helpers
- protected dashboard route
- login route
- settings route for BYOK keys
- basic marketing home page

Do not implement real SEO scanning yet. Stub the scanner with mock data but design all types and database schema so real scanning can be added next.

```
  
## Prompt 2 — Supabase Schema + RLS  
```
Create the Supabase database schema for HeadCheck.

Use the following core entities:

1. profiles
- id uuid primary key references auth.users(id)
- email text
- display_name text nullable
- tier text not null default 'freeloader'
- created_at timestamptz default now()
- updated_at timestamptz default now()

Allowed tiers:
- freeloader
- founder
- agency

2. github_installations
- id uuid primary key default gen_random_uuid()
- user_id uuid references profiles(id) not null
- github_installation_id bigint not null
- github_account_login text
- github_account_type text
- permissions jsonb
- repository_selection text
- created_at timestamptz default now()
- updated_at timestamptz default now()

3. sites
- id uuid primary key default gen_random_uuid()
- user_id uuid references profiles(id) not null
- github_installation_id uuid references github_installations(id)
- repo_url text not null
- repo_owner text not null
- repo_name text not null
- default_branch text nullable
- discovered_framework text nullable
- framework_confidence numeric nullable
- status text not null default 'active'
- check_frequency text not null default 'monthly'
- auto_create_prs boolean not null default false
- last_checked_at timestamptz nullable
- next_check_at timestamptz nullable
- created_at timestamptz default now()
- updated_at timestamptz default now()

Allowed check_frequency:
- monthly
- weekly
- daily

Allowed status:
- active
- paused
- error
- deleted

4. checks
- id uuid primary key default gen_random_uuid()
- site_id uuid references sites(id) not null
- user_id uuid references profiles(id) not null
- check_type text not null default 'manual'
- status text not null default 'queued'
- started_at timestamptz nullable
- completed_at timestamptz nullable
- summary jsonb nullable
- problem_count int not null default 0
- critical_count int not null default 0
- warning_count int not null default 0
- info_count int not null default 0
- created_at timestamptz default now()

Allowed check_type:
- manual
- scheduled

Allowed status:
- queued
- running
- completed
- failed

5. issues
- id uuid primary key default gen_random_uuid()
- check_id uuid references checks(id) not null
- site_id uuid references sites(id) not null
- user_id uuid references profiles(id) not null
- severity text not null
- issue_key text not null
- title text not null
- description text not null
- affected_file text nullable
- affected_route text nullable
- evidence jsonb nullable
- recommended_snippet text nullable
- fix_prompt text nullable
- validation_steps text[] nullable
- created_at timestamptz default now()

Allowed severity:
- critical
- warning
- info

6. user_api_keys
- id uuid primary key default gen_random_uuid()
- user_id uuid references profiles(id) not null
- provider text not null
- encrypted_api_key text not null
- key_label text nullable
- last_four text nullable
- created_at timestamptz default now()
- updated_at timestamptz default now()

Allowed providers:
- claude
- gemini

Important:
- Never expose encrypted_api_key to the client.
- Store only last_four visibly.
- Implement encryption/decryption through server-only helper functions.
- Use environment variable HEADCHECK_KEY_ENCRYPTION_SECRET for encryption.
- Use crypto AES-GCM or a secure equivalent.

7. tier_limits
This may be hardcoded in TypeScript instead of DB for MVP:
freeloader:
  max_sites: 1
  min_check_interval_days: 30
  allowed_frequencies: ['monthly']
  auto_prs: false
founder:
  max_sites: 6
  min_check_interval_days: 7
  allowed_frequencies: ['monthly', 'weekly']
  auto_prs: false
agency:
  max_sites: 20
  min_check_interval_days: 1
  allowed_frequencies: ['monthly', 'weekly', 'daily']
  auto_prs: true

Implement RLS:
- Users can select/update/delete only their own profiles row.
- Users can select/insert/update/delete only their own github_installations.
- Users can select/insert/update/delete only their own sites.
- Users can select checks/issues only where user_id = auth.uid().
- Users can insert checks only for their own sites.
- Users can never select encrypted_api_key directly from client queries.
- Prefer server actions for API key handling.

Also create:
- updated_at trigger function
- indexes on user_id, site_id, repo_url, last_checked_at, next_check_at
- unique constraint on sites(user_id, repo_owner, repo_name) where status != 'deleted'

```
  
## Prompt 3 — Auth + Protected Routes  
```
Implement Supabase Email Auth for HeadCheck using the Next.js App Router.

Requirements:
- Login page at /login
- Email magic link login
- Optional email/password can be added if easy, but magic link is enough
- Protected dashboard at /dashboard
- Middleware or server-side auth guard for protected routes
- After login, create or update a profile row
- User should land on /dashboard after auth
- Provide logout button

Routes:
- /
  - simple marketing page
  - HeadCheck logo/name
  - headline: "Next.js SEO checks and fix prompts you control."
  - CTA: "Start Free"
- /login
  - email input
  - send magic link
- /dashboard
  - protected
- /settings
  - protected
  - BYOK API key management
- /github/install
  - protected
  - starts GitHub App installation flow
- /github/callback
  - protected
  - handles installation callback

Use official Supabase SSR/App Router patterns and separate browser/server clients.

Important UI:
- Minimal white background
- Slate text
- Clean forms
- No heavy sidebar for MVP
- Top nav only:
  - HeadCheck
  - Dashboard
  - Settings
  - Logout

```
Supabase’s official Next.js quickstart is for App Router Auth and is the right reference point for this implementation. (++[Supabase](https://supabase.com/docs/guides/auth/quickstarts/nextjs?utm_source=chatgpt.com)++)  
  
## Prompt 4 — GitHub App Integration  
```
Implement GitHub App connection for HeadCheck.

Important:
Use a GitHub App, not a broad OAuth-only app, for repository access.

Goal:
- User signs into HeadCheck with email.
- User clicks "Connect GitHub."
- User installs the HeadCheck GitHub App on selected repositories.
- We store the installation ID and account info.
- When user adds a GitHub repo URL, verify that the GitHub App installation has access to that repo.
- For MVP, request read-only permissions:
  - Contents: Read-only
  - Metadata: Read-only
  - Pull requests: Read/write only for Agency later, but avoid enabling write permissions initially if possible
- If PR support is not implemented yet, do not request write access.

Environment variables:
- GITHUB_APP_ID
- GITHUB_APP_CLIENT_ID
- GITHUB_APP_CLIENT_SECRET
- GITHUB_APP_PRIVATE_KEY
- GITHUB_APP_WEBHOOK_SECRET
- GITHUB_APP_NAME

Implement:
1. "Connect GitHub" button on dashboard empty state.
2. GitHub App install URL generator.
3. Callback route that receives installation_id.
4. Store installation in github_installations table.
5. Helper to create GitHub App installation access token server-side.
6. Helper to parse repo URL:
   - https://github.com/owner/repo
   - git@github.com:owner/repo.git
   - github.com/owner/repo
7. Helper to fetch repo metadata:
   - owner
   - repo
   - default branch
   - repo html_url
8. Verify installation can access repo before adding site.

UX:
- On first signup, dashboard should show:
  - "Connect GitHub to start checking your Next.js SEO."
  - Button: "Connect GitHub"
- After GitHub is connected, show:
  - GitHub URL input
  - Add Site button
- If the user enters a repo URL the app cannot access:
  - Show friendly error:
    "HeadCheck cannot access this repo yet. Install the GitHub App on this repository or choose another URL."

Do not expose GitHub tokens to the client.

```
GitHub’s docs note that GitHub Apps use fine-grained permissions and short-lived tokens, making them better aligned with your trust-first “read-only by default” approach. (++[GitHub Docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps?utm_source=chatgpt.com)++)  
  
## Prompt 5 — Tier Rules + Site Management  
```
Implement tier-based limits and site management.

Hardcode tier config in lib/tiers.ts:

freeloader:
- label: "Freeloader"
- price: 0
- maxSites: 1
- minCheckIntervalDays: 30
- allowedFrequencies: ['monthly']
- canAutoCreatePrs: false

founder:
- label: "Founder"
- price: 19
- maxSites: 6
- minCheckIntervalDays: 7
- allowedFrequencies: ['monthly', 'weekly']
- canAutoCreatePrs: false

agency:
- label: "Agency"
- price: 49
- maxSites: 20
- minCheckIntervalDays: 1
- allowedFrequencies: ['monthly', 'weekly', 'daily']
- canAutoCreatePrs: true

Site management:
- Paid users can add/delete sites from dashboard.
- Freeloader can only add 1 site.
- Deleted sites should set status='deleted' instead of hard delete.
- Add Site flow:
  1. User pastes GitHub URL.
  2. Parse owner/repo.
  3. Check tier limit.
  4. Verify GitHub installation access.
  5. Fetch repo metadata.
  6. Discover framework.
  7. Insert site.
  8. Queue or run initial check.

Frequency:
- Freeloader:
  - No frequency control visible.
  - Always monthly.
- Founder:
  - Frequency selector allows monthly or weekly.
- Agency:
  - Frequency selector allows monthly, weekly, daily.
- Prevent manual checks if min interval has not elapsed.
- Show next allowed check time when blocked.

Dashboard:
- If no sites:
  - show centered empty state.
- If sites:
  - show grid of site cards.
- Site selector:
  - For paid users, subtle selector at top if multiple sites exist.
  - But dashboard should still show all cards.
- Add/Delete Site:
  - Use compact URL box.
  - Delete is subtle: small "Remove" link or menu on card.

Card design:
- White card
- Rounded corners
- Border or soft shadow
- Top content:
  - Last Check: date or "Never"
  - Problems Found: number
  - Fix Prompt link/button
  - GitHub logo icon linking to repo
- Bottom footer:
  - Slate strip
  - repo URL in white text
  - truncate long URL

```
  
## Prompt 6 — Framework Discovery  
```
Implement automatic framework discovery for GitHub repos.

When a site is added:
1. Use GitHub App installation token.
2. Fetch package.json from default branch.
3. Inspect dependencies/devDependencies/scripts.
4. Fetch repo file tree or selected files as needed.
5. Determine framework.

Supported discovery results:
- next-app-router
- next-pages-router
- next-mixed
- react-vite
- remix
- astro
- unknown

MVP priority:
- Strongly support Next.js App Router.
- Weakly identify others and show "Not fully supported yet."

Detection rules:
Next.js:
- package.json dependency includes "next"
- If /app directory exists and app/layout.tsx or app/layout.jsx exists => next-app-router
- If /pages directory exists and pages/_app.tsx or pages/index.tsx exists => next-pages-router
- If both /app and /pages exist => next-mixed

React Vite:
- package.json includes vite and react
- vite.config exists

Remix:
- package.json includes @remix-run

Astro:
- package.json includes astro

Store:
- discovered_framework
- framework_confidence from 0 to 1
- default_branch

UI:
- On card show small badge:
  - "Next.js App Router"
  - "Next.js Pages Router"
  - "React/Vite — limited"
  - "Unknown — limited"

If framework is unknown:
- Still allow adding site.
- Checker should return an informational issue:
  "HeadCheck could not confidently detect a supported framework."

```
  
## Prompt 7 — SEO Checker Engine MVP  
```
Build the HeadCheck SEO checker engine for Next.js App Router.

For MVP, scanner can use GitHub file reads, not full clone.

Inputs:
- site_id
- user_id
- repo owner/name
- default branch
- GitHub installation token

Output:
- check row
- issue rows
- summary json

Checks to implement first:

1. Missing metadataBase
- Inspect app/layout.tsx or app/layout.jsx
- If no metadataBase found in exported metadata, issue critical
- Fix prompt should instruct adding metadataBase with NEXT_PUBLIC_SITE_URL fallback

2. Missing root title template
- Inspect app/layout.tsx
- If no title template, issue warning

3. Missing sitemap
- Check for:
  - app/sitemap.ts
  - app/sitemap.js
  - public/sitemap.xml
  - next-sitemap config
- If missing, warning

4. Missing robots
- Check for:
  - app/robots.ts
  - app/robots.js
  - public/robots.txt
- If missing, warning

5. Dynamic route lacks generateMetadata
- Find app/**/[param]/**/page.tsx or page.jsx
- If no generateMetadata in same file and no obvious parent metadata pattern, warning

6. Potential draft/noindex risk
- If dynamic route fetches post/product/content and has no notFound/noindex handling, warning
- This can be heuristic.

7. Missing canonical
- Inspect metadata exports for alternates.canonical
- If pages have metadata but no canonical, warning

8. Relative OG image warning
- If openGraph images contain url beginning with "/" and metadataBase missing, critical
- If metadataBase exists, no issue

9. Missing JSON-LD for likely article pages
- If route path includes blog, posts, article, news, and no application/ld+json found, info/warning

10. Image alt hints
- Search page files for <Image usage without alt or alt=""
- Warning

11. Internal link weak coverage
- For MVP, simple heuristic:
  - If homepage has fewer than 3 internal Link hrefs, info
  - If blog pages do not link back to category/home, info

Each issue must include:
- severity
- issue_key
- title
- description
- affected_file
- affected_route if known
- evidence json
- recommended_snippet
- fix_prompt
- validation_steps

Create a scanner architecture:
- lib/scanner/github-reader.ts
- lib/scanner/framework-discovery.ts
- lib/scanner/next-app-router-checks.ts
- lib/scanner/issue-builders.ts
- lib/scanner/prompts.ts
- app/api/checks/run/route.ts or server action

Do not use the user's BYOK key for basic scanning.
Use BYOK only for AI-enhanced fix prompts.
If no API key exists, generate deterministic template prompts.

```
  
## Prompt 8 — Fix Prompt Generator  
```
Build the Fix Prompt system.

Each issue should have:
1. Plain-English explanation
2. Minimal code snippet
3. Cursor/Claude/Windsurf-ready refactor prompt
4. Validation steps

Create prompt templates for:

A. metadataBase fix
B. title template fix
C. canonical fix
D. sitemap.ts creation
E. robots.ts creation
F. dynamic generateMetadata fix
G. draft/noindex guard fix
H. JSON-LD Article schema fix
I. image alt fix
J. OG image absolute URL fix
K. internal linking fix

Style:
- Prompts should be safe and conservative.
- Always tell the coding agent:
  - preserve existing code
  - do not modify unrelated files
  - match existing style
  - apply the pattern to 1 or 2 examples first unless user asks for broad refactor
  - explain changes after editing
  - do not invent product facts
  - do not rewrite marketing copy aggressively unless requested

Example prompt format:

"You are editing a Next.js App Router codebase.

Goal:
Fix missing metadataBase in the root metadata setup.

Context:
HeadCheck detected that app/layout.tsx does not define metadataBase. This may cause relative Open Graph image URLs to fail in social previews.

Tasks:
1. Open app/layout.tsx.
2. If export const metadata exists, preserve all existing fields.
3. Add metadataBase using:
   new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com')
4. If there is no metadata export, create one using the existing site name if available.
5. Do not edit unrelated files.
6. Do not overwrite existing title/description/openGraph/twitter/robots fields.
7. After editing, tell me exactly what changed.

Validation:
- Confirm metadataBase exists.
- Confirm the project builds.
- Confirm View Source includes absolute OG URLs in production."

UI:
- Each issue row has:
  - "View Fix Prompt"
  - "Copy Prompt"
  - "Copy Snippet"
- Latest card has main "Fix Prompt" link that opens latest check with grouped issues.

```
  
## Prompt 9 — BYOK Claude / Gemini Settings  
```
Implement BYOK API key settings.

Providers:
- Claude
- Gemini

Settings page:
- User can add/update Claude API key
- User can add/update Gemini API key
- Show provider, label, last_four, created_at
- Never show full key after save
- User can delete key
- Show notice:
  "Your key is encrypted and only used server-side to generate optional enhanced fix prompts."

Security:
- API keys must never be sent to client after save.
- Encrypt server-side before storing.
- Decrypt only inside server actions or route handlers.
- Do not log API keys.
- Mask all keys.
- Add validation:
  - Claude key likely starts with sk-ant or current provider format if known, but do not over-enforce
  - Gemini key can be generic
- If no key exists:
  - app still runs deterministic checks
  - fix prompts are template-based

AI usage:
- For MVP, AI enhancement should be optional.
- Use deterministic templates first.
- Add button:
  "Enhance with my AI key"
- On click:
  - Send issue context and existing template prompt to provider
  - Ask model to improve prompt specificity without changing intent
  - Save enhanced fix_prompt to issue row

Do not build background mass AI generation yet.

```
  
## Prompt 10 — Dashboard UI  
```
Build the final HeadCheck dashboard UI.

Visual direction:
- Simple
- Clean
- White background
- Slate accents
- No bloated sidebar
- Feels like a focused utility
- Responsive mobile-first

Layout:
Top nav:
- HeadCheck wordmark left
- Tier badge
- Settings
- Logout

Hero/action area:
- If GitHub not connected:
  - Title: "Connect GitHub to check your Next.js SEO"
  - Subtitle: "HeadCheck uses read-only access to inspect metadata, sitemap, robots, schema, image tags, and route structure."
  - Button: "Connect GitHub"
- If GitHub connected:
  - URL input placeholder: "https://github.com/owner/repo"
  - Add Site button
  - For paid tier, frequency selector near URL input
  - For Freeloader, show small text: "Freeloader includes 1 URL and 1 check/month."

Dashboard cards:
Each card has:
- Top right GitHub icon link
- Framework badge
- Last Check Date
- Problems Found
- Critical/Warning breakdown if available
- Button: "View Fix Prompt"
- Button: "Run Check" if allowed
- If not allowed:
  - disabled button with tooltip/text: "Next check available on [date]"
- Small menu:
  - Change frequency
  - Remove site
- Slate footer strip:
  - white text repo URL
  - truncate long URLs

States:
- Loading skeletons
- Empty state
- Error state
- Unknown framework state
- Check running state
- Check completed state

Fix Prompt page:
Route:
/dashboard/sites/[siteId]/checks/[checkId]

Display:
- Site URL
- Check date
- Problem summary
- Issues grouped by severity
- For each issue:
  - title
  - severity badge
  - affected file
  - description
  - recommended snippet code block
  - fix prompt code block
  - copy buttons
  - validation steps checklist

Keep interface intentionally simple.

```
  
## Prompt 11 — Manual + Scheduled Checks  
```
Implement check execution and scheduling logic.

Manual checks:
- User can run check from site card.
- Before running:
  - verify user owns site
  - verify site status active
  - verify tier interval rules
  - verify GitHub installation access
- Create checks row with status queued/running
- Run scanner
- Save issues
- Update check summary
- Update site.last_checked_at
- Compute site.next_check_at based on frequency
- Return result

Frequency:
monthly = now + 30 days
weekly = now + 7 days
daily = now + 1 day

Scheduled checks:
- Create route /api/cron/run-scheduled-checks
- Protected by CRON_SECRET
- Finds active sites where next_check_at <= now
- Runs checks respecting tier limits
- Do not run deleted/paused/error sites
- Limit batch size for MVP to avoid timeouts
- Add logs

For deployment:
- Use Vercel Cron or Supabase Edge Function later.
- Keep route simple for MVP.

Important:
- If a user downgrades tier, enforce new limits:
  - Extra sites remain visible but paused/locked
  - Show upgrade message
- Do not auto-delete user sites on downgrade.

```
  
## Prompt 12 — Agency PR Placeholder  
```
Prepare the Agency auto-create PR feature, but do not fully implement code-writing yet.

Agency tier:
- Site card can show "Auto-create PRs" toggle.
- If enabled, show confirmation:
  "HeadCheck PRs are experimental. For now, HeadCheck will prepare PR-ready patches but will not submit them until this feature is enabled in a future release."
- Store auto_create_prs boolean only if user tier permits it.
- If Freeloader or Founder tries to enable it, show upgrade prompt.

Build placeholder architecture:
- lib/github/prs.ts
- createPullRequestForFixPack() stub
- Return "not implemented" safely
- No write calls to GitHub yet

Important:
- Do not request GitHub write permissions until PR creation is actually implemented.
- Keep MVP trust-first and read-only.

```
  
## Prompt 13 — Seed Mock Data + Demo Mode  
```
Add demo mode and seed data for easier testing.

Create demo scanner output for a sample Next.js repo:
Issues:
1. Missing metadataBase
2. Missing canonical on /about
3. Dynamic route app/blog/[slug]/page.tsx lacks generateMetadata
4. Missing sitemap.ts
5. Missing robots.ts
6. Missing Article JSON-LD for blog post
7. Image component missing alt text

Add development-only seed function:
- Create fake site for logged-in user
- Create fake check
- Create fake issues
- Button hidden behind NEXT_PUBLIC_ENABLE_DEMO_TOOLS=true

This helps test dashboard UI without GitHub setup.

```
  
## Prompt 14 — Copywriting + Landing Page  
```
Create the HeadCheck landing page.

Brand:
HeadCheck

Positioning:
Next.js SEO checks and fix prompts you control.

Hero:
"Fix silent Next.js SEO bugs without giving another app write access to your repo."

Subhead:
"HeadCheck scans your metadata, sitemap, robots, schema, image tags, and route structure — then gives you exact snippets and Cursor-ready prompts you control."

CTA:
"Start Free"

Secondary CTA:
"See sample fix prompt"

Sections:
1. Why HeadCheck
- Missing metadataBase
- Broken social previews
- Missing canonicals
- Draft pages accidentally indexed
- Weak sitemap/robots setup
- Missing JSON-LD

2. How it works
- Connect GitHub read-only
- Add a repo URL
- Run a check
- Copy the fix prompt into Cursor, Claude Code, or Windsurf
- Review and commit changes yourself

3. Pricing
Freeloader:
- $0
- 1 URL
- 1 check/month
- BYOK AI key

Founder:
- $19/mo
- 6 URLs
- Weekly checks
- Fix prompts
- BYOK AI key

Agency:
- $49/mo
- 20 URLs
- Daily checks
- Future PR automation
- BYOK AI key

4. Trust section
- No surprise PRs
- No auto-commits on Free/Founder
- Read-only first
- You control every code change

5. Footer
- Terms
- Privacy
- Contact

Style:
- Minimal
- White background
- Slate accents
- A few simple dashboard screenshots/components if possible

```
  
## Prompt 15 — Final MVP QA Checklist  
```
Audit the HeadCheck MVP implementation.

Check:
1. Supabase Auth works.
2. Protected routes redirect unauthenticated users.
3. Profile is created after signup.
4. User can connect GitHub App.
5. User can add GitHub repo URL.
6. App parses repo owner/name correctly.
7. App verifies GitHub installation access.
8. Framework discovery works for Next.js App Router.
9. Tier limits are enforced.
10. Freeloader can add only 1 site.
11. Founder can add up to 6 sites.
12. Agency can add up to 20 sites.
13. Freeloader cannot change frequency.
14. Founder can choose monthly/weekly.
15. Agency can choose monthly/weekly/daily.
16. Manual check respects min interval.
17. Check creates checks row.
18. Issues are saved correctly.
19. Dashboard cards render latest check data.
20. Fix Prompt page renders snippets and prompts.
21. Copy buttons work.
22. BYOK keys save encrypted.
23. BYOK keys never render back to client.
24. Scheduled cron route requires CRON_SECRET.
25. RLS prevents cross-user data access.
26. Deleted sites are soft-deleted.
27. Unknown frameworks show limited support message.
28. UI is mobile responsive.
29. No GitHub write permissions are requested for MVP.
30. No PRs are created unless explicitly implemented later.

After audit:
- List bugs found.
- Fix them.
- Then produce a short README with setup instructions:
  - env vars
  - Supabase migration
  - GitHub App setup
  - local dev
  - deployment notes

```
  
## Recommended MVP User Flow  
The cleanest first version:  
1. User signs up with email.  
2. User signs up with email.  
3. Dashboard says: **Connect GitHub**.  
4. Dashboard says: **Connect GitHub**.  
5. Dashboard says: **Connect GitHub**.  
6. Dashboard says: **Connect GitHub**.  
7. User installs GitHub App on selected repos.  
8. User installs GitHub App on selected repos.  
9. Dashboard shows one URL box.  
10. Dashboard shows one URL box.  
11. User pastes repo URL.  
12. User pastes repo URL.  
13. App discovers framework.  
14. App discovers framework.  
15. App creates dashboard card.  
16. App creates dashboard card.  
17. User clicks **Run Check**.  
18. User clicks **Run Check**.  
19. User clicks **Run Check**.  
20. User clicks **Run Check**.  
21. Card updates: “7 problems found.”  
22. Card updates: “7 problems found.”  
23. User clicks **Fix Prompt**.  
24. User clicks **Fix Prompt**.  
25. User clicks **Fix Prompt**.  
26. User clicks **Fix Prompt**.  
27. User copies prompt into Cursor/Claude Code.  
28. User copies prompt into Cursor/Claude Code.  
29. User keeps full control over code changes.  
30. User keeps full control over code changes.  
That is exactly the “simpler than SEOLint” wedge.  
  
## Suggested Env Vars  
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

HEADCHECK_KEY_ENCRYPTION_SECRET=
CRON_SECRET=

GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_NAME=

NEXT_PUBLIC_APP_URL=

```
  
## My final recommendation  
Build **Founder-first**, not Agency-first.  
The strongest MVP is:  
**$19/mo, 6 repos, weekly checks, BYOK AI key, no repo writes, copy-paste fix prompts.**  
**$19/mo, 6 repos, weekly checks, BYOK AI key, no repo writes, copy-paste fix prompts.**  
Agency PR automation can stay visible as a future upgrade, but the trust-first product should launch as:  
**HeadCheck: read-only Next.js SEO checks and AI-agent-ready fix prompts.**  
**HeadCheck: read-only Next.js SEO checks and AI-agent-ready fix prompts.**  
