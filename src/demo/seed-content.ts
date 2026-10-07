/**
 * Rich demo-seed content for the Acme Plumbing & HVAC sample site — theme,
 * pages, inbox, form submissions, and a nurture campaign, so every strong
 * screen in the demo has believable data.
 *
 * All builders are pure and deterministic (zero AI calls): pages go through
 * `buildGeneratedPage` + `prepareGeneratedPages` so they carry authoritative
 * containers/namedElements and pass Guardian validation exactly like the
 * wizard's apply path; the theme uses `parseDesignMdHeuristic` (never the AI
 * normalize) on a vendored DESIGN.md. `seedRichDemoContent` orchestrates the
 * store writes behind per-block idempotence guards and is called from
 * scripts/seed-demo.ts.
 */

import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';
import { getStorage } from '../storage/filesystem.js';
import { StyleGuideStore } from '../storage/style-guides.js';
import { EmailFormatStore } from '../storage/email-formats.js';
import { EmailTemplateStore } from '../storage/email-templates.js';
import { EmailFolderStore } from '../storage/email-folders.js';
import { EmailThreadStore } from '../storage/email-threads.js';
import { EmailMessageStore } from '../storage/email-messages.js';
import { CampaignStore } from '../storage/campaigns.js';
import { getDesignMdCached, listThemes } from '../design/awesome-design-md.js';
import { parseDesignMdHeuristic } from '../design/parse-design-md.js';
import { deriveEmailFormatFromStyleGuide } from '../design/email-format.js';
import { buildDefaultEmailTemplate } from '../design/email-template.js';
import { buildGeneratedPage, type BuiltSection } from '../ai/generate-page-content.js';
import { prepareGeneratedPages, type ApplyGeneratedPageInput } from '../api/sites.js';
import type { StyleGuide } from '../design/style-guide.js';
import type { EmailFolder, EmailThread, EmailMessage } from '../content/email-inbox-types.js';
import type { EmailCampaign, CampaignStep } from '../content/campaign-types.js';
import type { FormSubmission } from '../storage/types.js';

/** Vendored theme applied to the demo site — light, trustworthy, trade-friendly. */
export const DEMO_THEME_ID = 'stripe';

// ── Theme ─────────────────────────────────────────────────────────────────────

/** Parse the vendored theme without AI so the seed is deterministic and key-free. */
export async function buildDemoStyleGuide(): Promise<StyleGuide> {
  const theme = listThemes().find((t) => t.id === DEMO_THEME_ID);
  if (!theme) throw new Error(`demo theme "${DEMO_THEME_ID}" not in themes manifest`);
  const rawMd = await getDesignMdCached(theme.id);
  return parseDesignMdHeuristic(rawMd, theme.id, theme.name, theme.aesthetic);
}

// ── Pages ─────────────────────────────────────────────────────────────────────

const sec = (id: string, type: string, fields: Record<string, string>, items?: Array<Record<string, string>>): BuiltSection => ({
  id,
  type,
  content: { id, fields, items: items ?? [] },
});

const NAV = (): BuiltSection =>
  sec('nav', 'Nav', {
    brand: 'Acme Plumbing & HVAC',
    navLink1: 'Services',
    navLink2: 'About',
    navLink3: 'Contact',
    navCta: 'Get a quote',
  });

const FOOTER = (): BuiltSection =>
  sec('footer', 'Footer', {
    text: '© Acme Plumbing & HVAC — Serving the metro area since 2003',
    links: 'Licensed & insured · Mon–Sat 7am–6pm · (555) 010-4482',
  });

function homeSections(): BuiltSection[] {
  return [
    NAV(),
    sec('hero', 'HeroSection', {
      headline: 'Plumbing and HVAC, done right the first time.',
      subhead: 'Licensed, insured, and on time — trusted by metro-area homeowners for over twenty years.',
      primaryCta: 'Get a free quote',
      secondaryCta: 'See our services',
    }),
    sec(
      'services',
      'FeatureGrid',
      { title: 'What we do' },
      [
        { title: 'Emergency plumbing', body: 'Burst pipes, backed-up drains, and no-hot-water calls — answered day and night.' },
        { title: 'Water heaters', body: 'Tank and tankless installs, usually completed the same day you call.' },
        { title: 'Heating & cooling', body: 'Furnace and AC service, seasonal tune-ups, and full system replacements.' },
        { title: 'Leak detection', body: 'Non-invasive equipment finds the problem without tearing up your home.' },
      ]
    ),
    sec('why', 'InfoCard', {
      title: 'Why homeowners choose Acme',
      body: 'Family-owned since 2003. Every technician is licensed, background-checked, and insured — and every job is backed by our satisfaction guarantee.',
    }),
    sec(
      'testimonials',
      'TestimonialCard',
      { title: 'What customers say' },
      [
        { quote: 'They replaced our water heater the same afternoon we called. Professional from start to finish.', author: '— Maria G., Cedar Hills' },
        { quote: 'Honest pricing, no upselling, and the furnace has run perfectly since.', author: '— Dan W., Riverside' },
      ]
    ),
    sec('cta', 'CTASection', {
      headline: 'Need a plumber this week?',
      button: 'Book a visit',
    }),
    sec('contact', 'Form', {
      title: 'Get your free quote',
      intro: "Tell us what's going on and we'll get back to you within one business hour.",
      submit: 'Send request',
    }),
    FOOTER(),
  ];
}

function servicesSections(): BuiltSection[] {
  return [
    NAV(),
    sec('intro', 'Title', {
      title: 'Our services',
      subtitle: 'Upfront pricing on every job — you approve the quote before we start.',
    }),
    sec(
      'services',
      'FeatureGrid',
      { title: 'Everything we handle' },
      [
        { title: 'Emergency plumbing', body: '24/7 response for burst pipes, sewage backups, and major leaks.' },
        { title: 'Water heaters', body: 'Repair, replacement, and tankless upgrades with same-day installation.' },
        { title: 'Drain cleaning', body: 'Hydro-jetting and camera inspection to clear and diagnose stubborn lines.' },
        { title: 'Furnace repair', body: 'Diagnosis and repair for all major brands, plus seasonal safety checks.' },
        { title: 'AC installation', body: 'Right-sized, energy-efficient systems installed and tuned by certified techs.' },
        { title: 'Bathroom plumbing', body: 'Fixture swaps to full re-pipes for remodels, done to code.' },
      ]
    ),
    sec('cta', 'CTASection', {
      headline: 'Not sure what you need?',
      button: 'Talk to a technician',
    }),
    FOOTER(),
  ];
}

function aboutSections(): BuiltSection[] {
  return [
    NAV(),
    sec('intro', 'Title', {
      title: 'About Acme',
      subtitle: 'Two decades of showing up on time and standing behind our work.',
    }),
    sec('story', 'InfoCard', {
      title: 'Our story',
      body: 'Acme started in 2003 with one van and a simple rule: treat every home like your own. Today our twelve-person crew serves the whole metro area — same rule, more vans.',
    }),
    sec(
      'testimonials',
      'TestimonialCard',
      { title: 'Neighbors who trust us' },
      [{ quote: 'Twenty years with Acme and never a bad visit. They are the first call we make.', author: '— The Hendersons, Oak Grove' }]
    ),
    sec('cta', 'CTASection', {
      headline: 'Meet us at your door, not a call center.',
      button: 'Schedule a visit',
    }),
    FOOTER(),
  ];
}

function contactSections(): BuiltSection[] {
  return [
    NAV(),
    sec('intro', 'Title', {
      title: 'Contact us',
      subtitle: 'We reply within one business hour, Mon–Sat 7am–6pm.',
    }),
    sec('contact', 'Form', {
      title: 'Request a callback',
      intro: 'Describe the problem and the best time to reach you — a real technician will call back, not a bot.',
      submit: 'Request callback',
    }),
    FOOTER(),
  ];
}

/**
 * The four demo pages, in path-sorted order (matching how storage keeps
 * site.pages) so `buildGeneratedPage`'s page numbers line up with the final
 * `-pN` reconciliation in `prepareGeneratedPages`.
 */
export function buildDemoPages(): ApplyGeneratedPageInput[] {
  const defs: Array<{ path: string; title: string; sections: BuiltSection[] }> = [
    { path: '/', title: 'Home', sections: homeSections() },
    { path: '/about', title: 'About', sections: aboutSections() },
    { path: '/contact', title: 'Contact', sections: contactSections() },
    { path: '/services', title: 'Services', sections: servicesSections() },
  ];
  return defs.map((d, i) => ({ path: d.path, title: d.title, content: buildGeneratedPage(d.sections, i + 1) }));
}

// ── Email inbox ───────────────────────────────────────────────────────────────

const hoursAgo = (now: Date, h: number): string => new Date(now.getTime() - h * 3_600_000).toISOString();

export function buildDemoCustomFolders(siteId: string, now: Date): EmailFolder[] {
  const at = now.toISOString();
  return [
    {
      id: `fld_${nanoid(10)}`,
      siteId,
      name: 'Leads',
      kind: 'custom',
      order: 3,
      color: '#cc785c',
      filterRule: { matchType: 'keyword', value: 'quote' },
      createdAt: at,
      updatedAt: at,
    },
    {
      id: `fld_${nanoid(10)}`,
      siteId,
      name: 'Suppliers',
      kind: 'custom',
      order: 4,
      color: '#5b8db8',
      createdAt: at,
      updatedAt: at,
    },
  ];
}

interface DemoThreadDef {
  folder: 'inbox' | 'leads' | 'suppliers';
  subject: string;
  from: string;
  category: EmailThread['category'];
  isRead: boolean;
  ageHours: number;
  inboundBody: string;
  /** 'sent' adds an outbound sent reply; 'ai-draft' adds an outbound AI-generated draft. */
  reply?: 'sent' | 'ai-draft';
  replyBody?: string;
}

const ACME_FROM = 'office@acme-plumbing.example.com';

const DEMO_THREADS: DemoThreadDef[] = [
  {
    folder: 'inbox',
    subject: 'No hot water since this morning',
    from: 'karen.miller@example.com',
    category: 'personal',
    isRead: false,
    ageHours: 2,
    inboundBody:
      '<p>Hi — we woke up to no hot water at all. The tank is about 11 years old and there is a faint rumbling sound when it tries to heat. Can someone come out today?</p>',
    reply: 'ai-draft',
    replyBody:
      '<p>Hi Karen,</p><p>Sorry to hear that — an 11-year-old tank with rumbling is usually sediment buildup near end of life. We have a technician in your area this afternoon and can offer same-day replacement if needed. Does 2–4pm work for an assessment?</p><p>— Acme Plumbing &amp; HVAC</p>',
  },
  {
    folder: 'inbox',
    subject: 'Rattling noise from AC unit',
    from: 'j.ortiz@example.com',
    category: 'personal',
    isRead: false,
    ageHours: 7,
    inboundBody:
      '<p>Our outdoor AC unit started rattling loudly yesterday evening. It still cools but the noise is getting worse. Is this something urgent?</p>',
  },
  {
    folder: 'inbox',
    subject: 'Thank you — furnace works great',
    from: 'susan.lee@example.com',
    category: 'personal',
    isRead: true,
    ageHours: 30,
    inboundBody:
      '<p>Just wanted to say thanks to Mike and the crew — the new furnace has been flawless through the cold snap. We will recommend you to the neighbors!</p>',
    reply: 'sent',
    replyBody:
      '<p>Thank you Susan — that means a lot to the team. Enjoy the warm house, and remember your first annual tune-up is on us.</p><p>— Acme Plumbing &amp; HVAC</p>',
  },
  {
    folder: 'inbox',
    subject: 'Invoice question — job #2214',
    from: 'accounting@northsideproperty.example.com',
    category: 'personal',
    isRead: true,
    ageHours: 52,
    inboundBody:
      '<p>Could you resend the itemized invoice for job #2214 (unit 4B drain repair)? Our system only shows the summary total.</p>',
    reply: 'sent',
    replyBody: '<p>Of course — itemized invoice attached. Let us know if your system needs a different format.</p>',
  },
  {
    folder: 'leads',
    subject: 'Quote for bathroom remodel plumbing',
    from: 'dave.chen@example.com',
    category: 'personal',
    isRead: false,
    ageHours: 5,
    inboundBody:
      '<p>We are remodeling our main bathroom and need the plumbing moved for a new double vanity plus a walk-in shower. Could you give us a rough quote range? Happy to send the plans.</p>',
  },
  {
    folder: 'leads',
    subject: 'Water heater quote follow-up',
    from: 'p.novak@example.com',
    category: 'personal',
    isRead: true,
    ageHours: 26,
    inboundBody: '<p>Following up on the tankless quote from last week — does the price include removal of the old tank?</p>',
    reply: 'sent',
    replyBody: '<p>Hi Petra — yes, haul-away and disposal of the old tank are included in the quoted price. The quote is valid for 30 days.</p>',
  },
  {
    folder: 'suppliers',
    subject: 'Q3 price list — Apex Supply Co.',
    from: 'sales@apexsupply.example.com',
    category: 'promo',
    isRead: true,
    ageHours: 76,
    inboundBody: '<p>Attached is the Q3 contractor price list. Copper fittings are down 4% — stock up before the fall season.</p>',
  },
  {
    folder: 'inbox',
    subject: 'Metro Contractors Association — July bulletin',
    from: 'bulletin@metrocontractors.example.org',
    category: 'newsletter',
    isRead: true,
    ageHours: 100,
    inboundBody:
      '<p>This month: updated backflow-prevention code requirements, apprenticeship program dates, and the annual member BBQ signup.</p>',
  },
];

const stripTags = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Build threads + messages for the demo inbox. Message counts and
 * lastMessageAt are kept consistent with the built messages; one thread
 * carries an AI-generated draft so the badge shows in the demo.
 */
export function buildDemoEmailContent(
  siteId: string,
  folderIds: { inbox: string; leads: string; suppliers: string },
  now: Date
): { threads: EmailThread[]; messages: EmailMessage[] } {
  const threads: EmailThread[] = [];
  const messages: EmailMessage[] = [];

  for (const def of DEMO_THREADS) {
    const threadId = `thr_${nanoid(10)}`;
    const inboundAt = hoursAgo(now, def.ageHours);
    const replyAt = hoursAgo(now, Math.max(0, def.ageHours - 1));

    messages.push({
      id: `msg_${nanoid(10)}`,
      siteId,
      threadId,
      direction: 'inbound',
      status: 'received',
      from: def.from,
      to: [ACME_FROM],
      subject: def.subject,
      bodyHtml: def.inboundBody,
      sentAt: inboundAt,
      isRead: def.isRead,
      createdAt: inboundAt,
      updatedAt: inboundAt,
    });

    if (def.reply) {
      messages.push({
        id: `msg_${nanoid(10)}`,
        siteId,
        threadId,
        direction: 'outbound',
        status: def.reply === 'sent' ? 'sent' : 'draft',
        from: ACME_FROM,
        to: [def.from],
        subject: `Re: ${def.subject}`,
        bodyHtml: def.replyBody ?? '',
        isAiGenerated: def.reply === 'ai-draft' ? true : undefined,
        sentAt: replyAt,
        isRead: true,
        createdAt: replyAt,
        updatedAt: replyAt,
      });
    }

    // A draft doesn't advance the conversation clock; a sent reply does.
    const lastMessageAt = def.reply === 'sent' ? replyAt : inboundAt;
    threads.push({
      id: threadId,
      siteId,
      folderId: folderIds[def.folder],
      subject: def.subject,
      participantEmails: [def.from, ACME_FROM],
      lastMessageAt,
      messageCount: def.reply ? 2 : 1,
      isRead: def.isRead,
      snippet: stripTags(def.inboundBody).slice(0, 120),
      category: def.category,
      createdAt: inboundAt,
      updatedAt: lastMessageAt,
    });
  }

  return { threads, messages };
}

// ── Form submissions ──────────────────────────────────────────────────────────

export function buildDemoSubmissions(): Array<Omit<FormSubmission, 'id' | 'siteId' | 'createdAt'>> {
  return [
    {
      name: 'Karen Miller',
      email: 'karen.miller@example.com',
      message: 'No hot water since this morning — tank is about 11 years old. Please call as soon as possible.',
      pagePath: '/contact',
    },
    {
      name: 'Dave Chen',
      email: 'dave.chen@example.com',
      message: 'Looking for a quote on bathroom remodel plumbing: double vanity and a walk-in shower. Plans available.',
      pagePath: '/contact',
    },
    {
      name: 'Tom Baker',
      email: 'tom.baker@example.com',
      message: 'Kitchen sink drains slowly even after using a snake. Weekday afternoons work best for a visit.',
      pagePath: '/contact',
    },
    {
      name: 'Priya Sharma',
      email: 'priya.s@example.com',
      message: 'Interested in a seasonal HVAC maintenance plan for a 3-bed two-story house. What does it cover?',
      pagePath: '/contact',
    },
    {
      name: 'Northside Property Mgmt',
      email: 'maintenance@northsideproperty.example.com',
      message: 'We manage 40 rental units and are looking for a plumbing contractor on retainer. Who should we talk to?',
      pagePath: '/contact',
    },
  ];
}

// ── Nurture campaign ──────────────────────────────────────────────────────────

/**
 * A 3-step draft nurture sequence linked to the seeded water-heater pillar.
 * Stays 'draft' — the demo must never actually send via Resend.
 */
export function buildDemoCampaign(siteId: string, pillarId: string, now: Date): { campaign: EmailCampaign; steps: CampaignStep[] } {
  const at = now.toISOString();
  const campaign: EmailCampaign = {
    id: nanoid(12),
    siteId,
    pillarId,
    keyword: 'water heater replacement',
    name: 'Water heater replacement nurture',
    status: 'draft',
    createdAt: at,
    updatedAt: at,
  };

  const stepDefs = [
    {
      delayDays: 0,
      subject: 'Is your water heater trying to tell you something?',
      previewText: 'The 5 warning signs most homeowners miss.',
      bodyHtml:
        '<p>Rusty water, rumbling sounds, lukewarm showers — your water heater usually gives fair warning before it fails.</p><p>Here are the five signs it\'s time to plan a replacement (and how to avoid the cold-shower emergency): read our full guide.</p>',
    },
    {
      delayDays: 3,
      subject: 'Repair or replace? The 10-year rule of thumb',
      previewText: 'When a repair bill stops making sense.',
      bodyHtml:
        '<p>Once a tank passes ten years, most repairs cost more than they return — efficiency drops and the tank itself keeps corroding.</p><p>Our rule of thumb: if the repair costs more than a third of a new unit, replace. We\'ll give you both numbers up front.</p>',
    },
    {
      delayDays: 7,
      subject: 'Same-day water heater installation, free assessment',
      previewText: 'Tank or tankless — installed today.',
      bodyHtml:
        '<p>Ready to stop worrying about it? We carry tank and tankless options and can typically complete installation the same day.</p><p>Book a free assessment and we\'ll size the right unit for your home — no obligation.</p>',
    },
  ];

  const steps: CampaignStep[] = stepDefs.map((s, i) => ({
    id: nanoid(12),
    campaignId: campaign.id,
    siteId,
    order: i,
    subject: s.subject,
    previewText: s.previewText,
    bodyHtml: s.bodyHtml,
    delayDays: s.delayDays,
    createdAt: at,
    updatedAt: at,
  }));

  return { campaign, steps };
}

// ── Orchestrator (called from scripts/seed-demo.ts) ───────────────────────────

export interface SeedRichContentParams {
  siteId: string;
  pillarId: string;
  /** Same `{ dbPromise }` the seed script passes its other stores (undefined = filesystem). */
  storeOpts?: { dbPromise: Promise<Db> };
  log?: (msg: string) => void;
}

/**
 * Seed theme, pages, inbox, submissions, and campaign for the demo site.
 * Each block is idempotent — safe to run on every seed invocation.
 */
export async function seedRichDemoContent(params: SeedRichContentParams): Promise<void> {
  const { siteId, pillarId, storeOpts } = params;
  const log = params.log ?? ((msg: string) => console.log(`[seed] ${msg}`));
  const now = new Date();

  const storage = await getStorage();
  const site = await storage.getSite(siteId);
  if (!site) throw new Error(`site ${siteId} not found`);

  // (a) Theme / StyleGuide — mirrors POST /design/apply, minus the AI parse.
  if (!site.meta.styleGuideId) {
    const guide = await buildDemoStyleGuide();
    const guideStore = new StyleGuideStore(storeOpts);
    await guideStore.save(siteId, guide);
    await storage.updateSiteMeta(siteId, { styleGuideId: guide.meta.id });
    const formatStore = new EmailFormatStore(storeOpts);
    await formatStore.save(deriveEmailFormatFromStyleGuide(guide, siteId));
    log(`style guide applied: ${DEMO_THEME_ID}`);
  } else {
    log('style guide exists');
  }

  // (a2) Default email template — the inbox composer refuses to open a draft
  // without both a Format and a Template, so the seeded AI draft needs this.
  const templateStore = new EmailTemplateStore(storeOpts);
  const existingTemplates = await templateStore.list(siteId);
  if (existingTemplates.length === 0) {
    await templateStore.save(buildDefaultEmailTemplate(siteId, `et_${nanoid(10)}`));
    log('email template seeded: Standard');
  } else {
    log(`email templates exist (${existingTemplates.length})`);
  }

  // (b) Pages — same validate-then-persist path as POST /pages/apply-generated.
  if (site.pages.length === 0) {
    const prepared = prepareGeneratedPages(buildDemoPages(), site.pages);
    if (!prepared.ok) {
      throw new Error(`demo pages failed validation: ${prepared.error}${prepared.errors.length ? ` — ${prepared.errors.join('; ')}` : ''}`);
    }
    for (const page of prepared.newPages) {
      await storage.upsertPage(siteId, { id: nanoid(10), path: page.path, title: page.title, content: page.content });
    }
    log(`pages created: ${prepared.newPages.map((p) => p.path).join(', ')}`);
  } else {
    log(`pages exist (${site.pages.length})`);
  }

  // (c) Inbox — folders, threads, messages.
  const folderStore = new EmailFolderStore(storeOpts);
  const threadStore = new EmailThreadStore(storeOpts);
  const messageStore = new EmailMessageStore(storeOpts);
  const systemFolders = await folderStore.ensureSystemFolders(siteId);
  const existingThreads = await threadStore.list(siteId);
  if (existingThreads.length === 0) {
    const customFolders = buildDemoCustomFolders(siteId, now);
    for (const folder of customFolders) await folderStore.save(folder);
    const inbox = systemFolders.find((f) => f.systemType === 'inbox');
    if (!inbox) throw new Error('inbox system folder missing after ensureSystemFolders');
    const { threads, messages } = buildDemoEmailContent(
      siteId,
      {
        inbox: inbox.id,
        leads: customFolders[0].id,
        suppliers: customFolders[1].id,
      },
      now
    );
    for (const thread of threads) await threadStore.save(thread);
    for (const message of messages) await messageStore.save(message);
    log(`inbox seeded: ${threads.length} threads, ${messages.length} messages`);
  } else {
    log(`inbox exists (${existingThreads.length} threads)`);
  }

  // (d) Form submissions.
  const existingSubmissions = await storage.listSubmissions(siteId);
  if (existingSubmissions.length === 0) {
    for (const submission of buildDemoSubmissions()) await storage.addSubmission(siteId, submission);
    log('form submissions seeded: 5');
  } else {
    log(`form submissions exist (${existingSubmissions.length})`);
  }

  // (e) Nurture campaign (draft only — never sends).
  const campaignStore = new CampaignStore(storeOpts);
  const existingCampaigns = await campaignStore.listCampaigns(siteId);
  if (existingCampaigns.length === 0) {
    const { campaign, steps } = buildDemoCampaign(siteId, pillarId, now);
    await campaignStore.saveCampaign(campaign);
    await campaignStore.saveSteps(siteId, campaign.id, steps);
    log(`campaign created: ${campaign.name} (${steps.length} steps)`);
  } else {
    log(`campaign exists (${existingCampaigns.length})`);
  }
}
