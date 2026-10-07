import { describe, it, expect, vi } from 'vitest';
import { sendDueCampaignSteps, type CampaignSendDeps } from './send-campaign-steps.js';
import { advanceEnrollment, createEnrollment, stopEnrollment } from '../email/campaign-engine.js';
import type { CampaignEnrollment, CampaignStep, EmailCampaign } from '../content/campaign-types.js';
import type { Site, Subscriber } from '../storage/types.js';

const NOW = '2026-09-22T12:00:00.000Z';

function step(order: number, delayDays: number): CampaignStep {
  return {
    id: `step${order}`,
    campaignId: 'c1',
    siteId: 'site1',
    order,
    subject: `Email ${order + 1}`,
    previewText: '',
    bodyHtml: `<p>step ${order}</p>`,
    delayDays,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const CAMPAIGN: EmailCampaign = {
  id: 'c1',
  siteId: 'site1',
  pillarId: 'p1',
  keyword: 'kw',
  name: 'Nurture',
  status: 'active',
  engine: 'native',
  createdAt: NOW,
  updatedAt: NOW,
};

const SUBSCRIBER: Subscriber = {
  id: 'sub1',
  siteId: 'site1',
  email: 'a@b.com',
  status: 'confirmed',
  unsubscribeToken: 'unsub-token',
  createdAt: NOW,
  confirmedAt: NOW,
};

const SITE = {
  meta: {
    id: 'site1',
    name: 'Acme',
    email: { enabled: true, resendApiKey: 're_key', fromEmail: 'hi@acme.com' },
    createdAt: NOW,
    updatedAt: NOW,
  },
  pages: [],
} as unknown as Site;

function makeDeps(overrides: {
  enrollment?: CampaignEnrollment;
  campaign?: EmailCampaign | null;
  steps?: CampaignStep[];
  subscriber?: Subscriber | null;
  sendResult?: { id?: string; error?: string };
}) {
  const enrollment =
    overrides.enrollment ?? createEnrollment(CAMPAIGN, overrides.steps ?? [step(0, 0)], SUBSCRIBER, NOW);
  const saved: CampaignEnrollment[] = [];
  const send = vi.fn().mockResolvedValue(overrides.sendResult ?? { id: 'msg1' });
  const deps: Partial<CampaignSendDeps> = {
    campaigns: {
      listDueEnrollments: vi.fn().mockResolvedValue([enrollment]),
      getEnrollmentById: vi.fn().mockResolvedValue(enrollment),
      getCampaign: vi.fn().mockResolvedValue(overrides.campaign === undefined ? CAMPAIGN : overrides.campaign),
      listSteps: vi.fn().mockResolvedValue(overrides.steps ?? [step(0, 0)]),
      saveEnrollment: vi.fn().mockImplementation(async (e: CampaignEnrollment) => {
        saved.push(e);
        return e;
      }),
    },
    storage: {
      getSite: vi.fn().mockResolvedValue(SITE),
      findSubscriberByEmail: vi
        .fn()
        .mockResolvedValue(overrides.subscriber === undefined ? SUBSCRIBER : overrides.subscriber),
    } as unknown as CampaignSendDeps['storage'],
    send,
    renderStep: vi.fn().mockImplementation(async (_siteId, s: CampaignStep) => s.bodyHtml),
    getPlanTier: async () => 'pro' as const,
    now: () => NOW,
  };
  return { deps, send, saved, enrollment };
}

describe('sendDueCampaignSteps', () => {
  it('sends the due step with compliance headers + unsubscribe footer, then advances', async () => {
    const steps = [step(0, 0), step(1, 2)];
    const { deps, send, saved } = makeDeps({ steps });

    await sendDueCampaignSteps(deps);

    expect(send).toHaveBeenCalledTimes(1);
    const [emailConfig, message] = send.mock.calls[0];
    expect(emailConfig).toBe(SITE.meta.email);
    expect(message.to).toBe('a@b.com');
    expect(message.subject).toBe('Email 1');
    expect(message.html).toContain('<p>step 0</p>');
    expect(message.html).toContain('unsubscribe?token=unsub-token');
    expect(message.headers['List-Unsubscribe']).toContain('unsubscribe?token=unsub-token');
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    expect(saved).toHaveLength(1);
    expect(saved[0].nextStepOrder).toBe(1);
    expect(saved[0].status).toBe('active');
  });

  it('completes the enrollment after the final step', async () => {
    const { deps, saved } = makeDeps({ steps: [step(0, 0)] });
    await sendDueCampaignSteps(deps);
    expect(saved[0].status).toBe('completed');
    expect('nextSendAt' in saved[0]).toBe(false);
  });

  it('skips (without stopping) when the campaign is paused', async () => {
    const { deps, send, saved } = makeDeps({ campaign: { ...CAMPAIGN, status: 'paused' } });
    await sendDueCampaignSteps(deps);
    expect(send).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('stops the enrollment when the subscriber is no longer confirmed', async () => {
    const { deps, send, saved } = makeDeps({ subscriber: { ...SUBSCRIBER, status: 'unsubscribed' } });
    await sendDueCampaignSteps(deps);
    expect(send).not.toHaveBeenCalled();
    expect(saved[0].status).toBe('stopped');
    expect(saved[0].stopReason).toBe('unsubscribed');
  });

  it('skips a legacy Resend-era "active" campaign that was never natively activated', async () => {
    const { engine: _engine, ...legacy } = CAMPAIGN;
    const { deps, send, saved } = makeDeps({ campaign: { ...legacy, resendAutomationId: 'pending-c1' } });
    await sendDueCampaignSteps(deps);
    expect(send).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('claims (advances) the enrollment, then restores it for retry when the provider send fails', async () => {
    const { deps, saved, enrollment } = makeDeps({
      steps: [step(0, 0), step(1, 2)],
      sendResult: { error: 'provider down' },
    });
    await sendDueCampaignSteps(deps);
    expect(saved).toHaveLength(2);
    expect(saved[0].nextStepOrder).toBe(1); // the pre-send claim
    expect(saved[1]).toEqual(enrollment); // released — retried next tick
  });

  it('does nothing below the email-system tier', async () => {
    const { deps, send } = makeDeps({});
    await sendDueCampaignSteps({ ...deps, getPlanTier: async () => 'free' as const });
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * In-memory enrollment store for the claim-before-send tests: reads return copies, like a real
 * store, so a due-list snapshot can go stale while the stored record moves on.
 */
function memoryCampaigns(initial: CampaignEnrollment[], steps: CampaignStep[]) {
  const rows = new Map(initial.map((e) => [e.id, structuredClone(e)]));
  const store = {
    listDueEnrollments: vi.fn(async (nowIso: string) =>
      [...rows.values()]
        .filter((e) => e.status === 'active' && e.nextSendAt && e.nextSendAt <= nowIso)
        .map((e) => structuredClone(e))
    ),
    getEnrollmentById: vi.fn(async (_siteId: string, id: string) => {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    }),
    getCampaign: vi.fn(async () => CAMPAIGN),
    listSteps: vi.fn(async () => steps),
    saveEnrollment: vi.fn(async (e: CampaignEnrollment) => {
      rows.set(e.id, structuredClone(e));
      return e;
    }),
  };
  return { rows, store };
}

function memoryDeps(store: CampaignSendDeps['campaigns'], send: CampaignSendDeps['send']): Partial<CampaignSendDeps> {
  return {
    campaigns: store,
    storage: {
      getSite: vi.fn().mockResolvedValue(SITE),
      findSubscriberByEmail: vi.fn().mockResolvedValue(SUBSCRIBER),
    } as unknown as CampaignSendDeps['storage'],
    send,
    renderStep: async (_siteId, s) => s.bodyHtml,
    getPlanTier: async () => 'pro' as const,
    now: () => NOW,
  };
}

describe('sendDueCampaignSteps — claim before send', () => {
  const steps = [step(0, 0), step(1, 2)];

  it('persists the advanced enrollment before the provider is called', async () => {
    const e = createEnrollment(CAMPAIGN, steps, SUBSCRIBER, NOW);
    const { rows, store } = memoryCampaigns([e], steps);
    const orderAtSend: number[] = [];
    const send = vi.fn(async () => {
      orderAtSend.push(rows.get(e.id)!.nextStepOrder);
      return { id: 'msg1' };
    });
    await sendDueCampaignSteps(memoryDeps(store, send));
    expect(orderAtSend).toEqual([1]);
  });

  it('restores the pre-send enrollment when the send throws, and retries it next tick', async () => {
    const e = createEnrollment(CAMPAIGN, steps, SUBSCRIBER, NOW);
    const { rows, store } = memoryCampaigns([e], steps);
    const send = vi.fn().mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce({ id: 'msg1' });

    await sendDueCampaignSteps(memoryDeps(store, send));
    expect(rows.get(e.id)).toEqual(e);

    await sendDueCampaignSteps(memoryDeps(store, send));
    expect(send).toHaveBeenCalledTimes(2);
    expect(rows.get(e.id)!.nextStepOrder).toBe(1);
  });

  it('never resends a successful step, even if every write after the send fails', async () => {
    const e = createEnrollment(CAMPAIGN, steps, SUBSCRIBER, NOW);
    const { rows, store } = memoryCampaigns([e], steps);
    let sent = false;
    const send = vi.fn(async () => {
      sent = true;
      return { id: 'msg1' };
    });
    const save = store.saveEnrollment.getMockImplementation()!;
    store.saveEnrollment.mockImplementation(async (x: CampaignEnrollment) => {
      if (sent) throw new Error('disk full');
      return save(x);
    });

    await sendDueCampaignSteps(memoryDeps(store, send));
    await sendDueCampaignSteps(memoryDeps(store, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(rows.get(e.id)!.nextStepOrder).toBe(1);
  });

  it('skips a stale snapshot whose step another run already sent', async () => {
    const e = createEnrollment(CAMPAIGN, steps, SUBSCRIBER, NOW);
    // The stored record has moved on (step 0 sent, step 1 due in 2 days); the due list still holds the old copy.
    const { store } = memoryCampaigns([advanceEnrollment(e, steps, NOW)], steps);
    store.listDueEnrollments.mockResolvedValueOnce([e]);
    const send = vi.fn().mockResolvedValue({ id: 'msg1' });

    await sendDueCampaignSteps(memoryDeps(store, send));

    expect(send).not.toHaveBeenCalled();
    expect(store.saveEnrollment).not.toHaveBeenCalled();
  });

  it('skips a snapshot whose enrollment was stopped since it was listed', async () => {
    const e = createEnrollment(CAMPAIGN, steps, SUBSCRIBER, NOW);
    const { store } = memoryCampaigns([stopEnrollment(e, 'unsubscribed', NOW)], steps);
    store.listDueEnrollments.mockResolvedValueOnce([e]);
    const send = vi.fn().mockResolvedValue({ id: 'msg1' });

    await sendDueCampaignSteps(memoryDeps(store, send));

    expect(send).not.toHaveBeenCalled();
  });
});
