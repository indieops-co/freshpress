import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type BlogSilo,
  type CampaignAudience,
  type CampaignStep,
  type EmailFormat,
  type EmailTemplate,
  type SiteEmailBrandDefaults,
} from '../api';
import HumanizePanel from '../components/HumanizePanel';
import BrandComposeControls from '../components/email-design/BrandComposeControls';

interface Props {
  siteId: string;
}

/**
 * Only natively-activated campaigns send. Ones left 'active' by the old Resend Automations
 * stub (no `engine` marker) are treated as paused until the owner activates them again.
 */
function isLive(c: { status?: string; engine?: 'native' }) {
  return c.status === 'active' && c.engine === 'native';
}

function isLegacyActive(c: { status?: string; engine?: 'native' }) {
  return c.status === 'active' && c.engine !== 'native';
}

/** The site-wide catch-all. Campaigns without an audience predate it and are per-pillar. */
function isWelcome(c: { audience?: CampaignAudience }) {
  return c.audience === 'welcome';
}

export default function CampaignsPage({ siteId }: Props) {
  const [silos, setSilos] = useState<BlogSilo[]>([]);
  const [campaigns, setCampaigns] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      pillarId?: string;
      keyword?: string;
      engine?: 'native';
      audience?: CampaignAudience;
    }>
  >([]);
  const [selected, setSelected] = useState<{
    campaign: { id: string; name: string; status?: string; engine?: 'native'; audience?: CampaignAudience };
    steps: CampaignStep[];
    enrollments?: { active: number; completed: number; stopped: number };
  } | null>(null);
  const [enrollExisting, setEnrollExisting] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [formats, setFormats] = useState<EmailFormat[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [brandDefaults, setBrandDefaults] = useState<SiteEmailBrandDefaults | null>(null);

  const refresh = useCallback(() => {
    api.listBlogSilos(siteId).then(setSilos);
    api.listCampaigns(siteId).then(setCampaigns).catch(() => setCampaigns([]));
  }, [siteId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    api.listEmailFormats(siteId).then((r) => setFormats(r.formats)).catch(() => setFormats([]));
    api.listEmailTemplates(siteId).then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
    api
      .getEmailBrandDefaults(siteId)
      .then((r) => setBrandDefaults(r.brandDefaults))
      .catch(() => setBrandDefaults(null));
  }, [siteId]);

  function patchStep(stepId: string, patch: Partial<CampaignStep>) {
    setSelected((prev) =>
      prev
        ? { ...prev, steps: prev.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
        : prev
    );
    if (!selected) return;
    void api.updateCampaignStep(siteId, selected.campaign.id, stepId, patch);
  }

  async function create(request: () => ReturnType<typeof api.createCampaign>) {
    setLoading(true);
    setError('');
    try {
      const res = await request();
      refresh();
      // The detail read, not the create response, carries the enrollment counts.
      await openCampaign(res.campaign.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setLoading(false);
    }
  }

  async function openCampaign(id: string) {
    const res = await api.getCampaign(siteId, id);
    setSelected({ campaign: res.campaign, steps: res.steps, enrollments: res.enrollments });
    setSelectedStepId(res.steps[0]?.id ?? null);
    // Opt-in is per campaign (and per activation) — never carry a checked box over.
    setEnrollExisting(false);
  }

  async function activate(id: string) {
    setLoading(true);
    try {
      await api.activateCampaign(siteId, id, { enrollExisting });
      refresh();
      await openCampaign(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activate failed');
    } finally {
      setLoading(false);
    }
  }

  async function pause(id: string) {
    setLoading(true);
    try {
      await api.pauseCampaign(siteId, id);
      refresh();
      await openCampaign(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Campaigns</h2>
      <p className="dash-page__muted">
        Pillar-linked nurture sequences, sent by FreshPress through your email provider. When someone signs
        up on a pillar's page or one of its posts and confirms, they're enrolled in that pillar's active campaign.
        An optional welcome campaign catches everyone else.
      </p>
      {error && <p className="dash-page__error">{error}</p>}

      <div className="blog-page__layout">
        <aside>
          <h3 style={{ fontSize: '1rem' }}>Create from pillar</h3>
          {silos.map(({ pillar }) => {
            // One per pillar (the API 409s a second): two would enroll the same signups in both sequences.
            const hasCampaign = campaigns.some((c) => c.pillarId === pillar.id);
            return (
              <button
                key={pillar.id}
                type="button"
                className="secondary"
                style={{ display: 'block', width: '100%', marginBottom: '0.5rem', textAlign: 'left' }}
                disabled={loading || hasCampaign}
                title={hasCampaign ? 'This pillar already has a campaign — open it from the list below' : undefined}
                onClick={() => void create(() => api.createCampaign(siteId, pillar.id))}
              >
                {pillar.title}
                {hasCampaign && <span className="dash-page__muted"> · has a campaign</span>}
              </button>
            );
          })}

          {!campaigns.some(isWelcome) && (
            <>
              <h3 style={{ fontSize: '1rem', marginTop: '1rem' }}>Everyone else</h3>
              <button
                type="button"
                className="secondary"
                style={{ display: 'block', width: '100%', marginBottom: '0.5rem', textAlign: 'left' }}
                disabled={loading}
                onClick={() => void create(() => api.createWelcomeCampaign(siteId))}
              >
                Create welcome campaign — for signups that don't come from a blog post
              </button>
            </>
          )}

          <h3 style={{ fontSize: '1rem', marginTop: '1rem' }}>Campaigns</h3>
          <ul className="blog-silo__posts">
            {campaigns.map((c) => (
              <li key={c.id}>
                <button type="button" className="blog-silo__post-btn" onClick={() => void openCampaign(c.id)}>
                  {c.name}
                  <span>
                    {isWelcome(c) && 'welcome · '}
                    {isLegacyActive(c) ? 'paused' : c.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main>
          {!selected && <p className="dash-page__muted">Create or select a campaign.</p>}
          {selected && (
            <div className="panel">
              <h3>{selected.campaign.name}</h3>
              {isWelcome(selected.campaign) && (
                <p className="dash-page__muted">
                  Welcome campaign: confirmed subscribers who signed up anywhere your active blog campaigns don't
                  cover — your homepage, landing pages, contact page, or a blog pillar without an active campaign —
                  get this sequence instead.
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {selected.steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={s.id === selectedStepId ? '' : 'secondary'}
                    onClick={() => setSelectedStepId(s.id)}
                  >
                    Email {i + 1}
                  </button>
                ))}
              </div>
              {selected.steps
                .filter((s) => s.id === selectedStepId)
                .map((s) => (
                  <div key={s.id}>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                      <BrandComposeControls
                        formats={formats}
                        templates={templates}
                        formatId={s.formatId ?? brandDefaults?.activeFormatId ?? ''}
                        onFormatIdChange={(id) => patchStep(s.id, { formatId: id })}
                        templateId={s.templateId ?? brandDefaults?.activeTemplateId ?? ''}
                        onTemplateIdChange={(id) => patchStep(s.id, { templateId: id })}
                        includeBrand={s.includeBrand ?? brandDefaults?.includeBrandDefault ?? true}
                        onIncludeBrandChange={(value) => patchStep(s.id, { includeBrand: value })}
                        includeSignature={s.includeSignature ?? brandDefaults?.includeSignatureDefault ?? true}
                        onIncludeSignatureChange={(value) => patchStep(s.id, { includeSignature: value })}
                      />
                    </div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                      Subject
                      <input
                        value={s.subject}
                        onChange={(e) => {
                          const subject = e.target.value;
                          setSelected((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  steps: prev.steps.map((st) =>
                                    st.id === s.id ? { ...st, subject } : st
                                  ),
                                }
                              : prev
                          );
                        }}
                        onBlur={() =>
                          void api.updateCampaignStep(siteId, selected.campaign.id, s.id, {
                            subject: s.subject,
                          })
                        }
                        style={{ width: '100%', marginTop: '0.25rem' }}
                      />
                    </label>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                      Preview text
                      <input
                        value={s.previewText}
                        onChange={(e) => {
                          const previewText = e.target.value;
                          setSelected((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  steps: prev.steps.map((st) =>
                                    st.id === s.id ? { ...st, previewText } : st
                                  ),
                                }
                              : prev
                          );
                        }}
                        onBlur={() =>
                          void api.updateCampaignStep(siteId, selected.campaign.id, s.id, {
                            previewText: s.previewText,
                          })
                        }
                        style={{ width: '100%', marginTop: '0.25rem' }}
                      />
                    </label>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                      Body HTML
                      <textarea
                        rows={8}
                        value={s.bodyHtml}
                        onChange={(e) => {
                          const bodyHtml = e.target.value;
                          setSelected((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  steps: prev.steps.map((st) =>
                                    st.id === s.id ? { ...st, bodyHtml } : st
                                  ),
                                }
                              : prev
                          );
                        }}
                        onBlur={() =>
                          void api.updateCampaignStep(siteId, selected.campaign.id, s.id, {
                            bodyHtml: s.bodyHtml,
                          })
                        }
                        style={{ width: '100%', marginTop: '0.25rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
                      />
                    </label>
                    <p className="dash-page__muted">
                      Wait {s.delayDays} day{s.delayDays === 1 ? '' : 's'} after previous email
                    </p>
                    <HumanizePanel
                      siteId={siteId}
                      contentHtml={s.bodyHtml}
                      contentType="email"
                      humanizeTarget={{
                        kind: 'campaign',
                        campaignId: selected.campaign.id,
                        stepId: s.id,
                      }}
                      onAccept={(html) => {
                        setSelected((prev) =>
                          prev
                            ? {
                                ...prev,
                                steps: prev.steps.map((st) =>
                                  st.id === s.id ? { ...st, bodyHtml: html } : st
                                ),
                              }
                            : prev
                        );
                        void api.updateCampaignStep(siteId, selected.campaign.id, s.id, {
                          bodyHtml: html,
                        });
                      }}
                    />
                  </div>
                ))}
              {selected.enrollments && (
                <p className="dash-page__muted" style={{ marginTop: '1rem' }}>
                  Enrollments: {selected.enrollments.active} active · {selected.enrollments.completed} completed ·{' '}
                  {selected.enrollments.stopped} stopped
                </p>
              )}
              {isLive(selected.campaign) ? (
                <button type="button" className="secondary" style={{ marginTop: '0.5rem' }} disabled={loading} onClick={() => void pause(selected.campaign.id)}>
                  Pause campaign
                </button>
              ) : (
                <>
                  {isLegacyActive(selected.campaign) && (
                    <p className="dash-page__muted" style={{ marginTop: '1rem' }}>
                      Paused: this campaign was activated under the old Resend Automations setup. FreshPress now
                      sends campaigns itself, so it won't enroll or send anyone until you activate it again.
                    </p>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                    <input type="checkbox" checked={enrollExisting} onChange={(e) => setEnrollExisting(e.target.checked)} />
                    {isWelcome(selected.campaign)
                      ? "Also enroll existing confirmed subscribers no active blog campaign covers — homepage, landing-page and other non-blog signups, plus signups on a pillar without an active campaign"
                      : "Also enroll existing confirmed subscribers who signed up on this pillar's page or one of its posts"}
                  </label>
                  <button type="button" style={{ marginTop: '0.5rem' }} disabled={loading} onClick={() => void activate(selected.campaign.id)}>
                    Activate campaign
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
