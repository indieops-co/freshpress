import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { api, type EmailFormat, type EmailTemplate, type SiteEmailBrandDefaults } from '../../api';
import BrandComposeControls from '../email-design/BrandComposeControls';
import TipTapEditor from '../blog/TipTapEditor';

const GUTTER_OPTIONS = [
  { label: 'Default (brand)', value: '' },
  { label: 'Narrow', value: '16px' },
  { label: 'Normal', value: '24px' },
  { label: 'Wide', value: '40px' },
];

type SendDelay = 'now' | '15m' | '30m' | '1h' | 'tonight' | 'tomorrow' | 'custom';

const DELAY_OPTIONS: { label: string; value: SendDelay }[] = [
  { label: 'Now', value: 'now' },
  { label: '15 minutes', value: '15m' },
  { label: '30 minutes', value: '30m' },
  { label: '1 hour', value: '1h' },
  { label: 'Tonight', value: 'tonight' },
  { label: 'Tomorrow morning', value: 'tomorrow' },
  { label: 'Custom…', value: 'custom' },
];

/** Next occurrence (today if still ahead, else tomorrow) of a given local hour:minute. */
function nextLocalTime(hour: number, minute: number): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(hour, minute);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function computeScheduledAt(delay: SendDelay, customDateTime: string): string | undefined {
  switch (delay) {
    case 'now':
      return undefined;
    case '15m':
      return new Date(Date.now() + 15 * 60_000).toISOString();
    case '30m':
      return new Date(Date.now() + 30 * 60_000).toISOString();
    case '1h':
      return new Date(Date.now() + 60 * 60_000).toISOString();
    case 'tonight':
      return nextLocalTime(20, 0).toISOString();
    case 'tomorrow':
      return nextLocalTime(8, 0).toISOString();
    case 'custom':
      return customDateTime ? new Date(customDateTime).toISOString() : undefined;
  }
}

/** ISO timestamp -> the local "YYYY-MM-DDTHH:mm" shape <input type="datetime-local"> expects. */
function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface ComposedMessage {
  to?: string[];
  subject?: string;
  bodyHtml: string;
  formatId?: string;
  templateId?: string;
  includeBrand?: boolean;
  includeSignature?: boolean;
  plainTextOnly?: boolean;
  gutterOverride?: string;
  scheduledAt?: string;
}

interface Props {
  siteId: string;
  showTo?: boolean;
  showSubject?: boolean;
  initialTo?: string;
  initialSubject?: string;
  initialBodyHtml?: string;
  /** Pre-populates the delay dropdown as Custom… with this time when reopening an already-scheduled message. */
  initialScheduledAt?: string;
  sendLabel?: string;
  onSend: (data: ComposedMessage) => Promise<void>;
  onSaveDraft: (data: ComposedMessage) => Promise<void>;
}

export default function MessageComposer({
  siteId,
  showTo,
  showSubject,
  initialTo,
  initialSubject,
  initialBodyHtml,
  initialScheduledAt,
  sendLabel,
  onSend,
  onSaveDraft,
}: Props) {
  const [formats, setFormats] = useState<EmailFormat[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [formatId, setFormatId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [includeBrand, setIncludeBrand] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [plainTextOnly, setPlainTextOnly] = useState(false);
  const [gutterOverride, setGutterOverride] = useState('');
  const [to, setTo] = useState(initialTo ?? '');
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [bodyHtml, setBodyHtml] = useState(initialBodyHtml ?? '<p></p>');
  const [delay, setDelay] = useState<SendDelay>(initialScheduledAt ? 'custom' : '15m');
  const [customDateTime, setCustomDateTime] = useState(
    initialScheduledAt ? toDateTimeLocalValue(initialScheduledAt) : ''
  );
  const [busy, setBusy] = useState<'send' | 'draft' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.listEmailFormats(siteId), api.listEmailTemplates(siteId), api.getEmailBrandDefaults(siteId)])
      .then(([fRes, tRes, dRes]: [{ formats: EmailFormat[] }, { templates: EmailTemplate[] }, { brandDefaults: SiteEmailBrandDefaults }]) => {
        setFormats(fRes.formats);
        setTemplates(tRes.templates);
        const defaults = dRes.brandDefaults;
        setFormatId(defaults.activeFormatId ?? fRes.formats.find((f) => f.isDefault)?.id ?? fRes.formats[0]?.id ?? '');
        setTemplateId(
          defaults.activeTemplateId ?? tRes.templates.find((t) => t.isDefault)?.id ?? tRes.templates[0]?.id ?? ''
        );
        setIncludeBrand(defaults.includeBrandDefault);
        setIncludeSignature(defaults.includeSignatureDefault);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load brand settings'));
  }, [siteId]);

  function buildData(opts?: { includeSchedule?: boolean }): ComposedMessage {
    return {
      to: showTo ? to.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      subject: showSubject ? subject : undefined,
      bodyHtml,
      formatId,
      templateId,
      includeBrand,
      includeSignature,
      plainTextOnly,
      gutterOverride: gutterOverride || undefined,
      scheduledAt: opts?.includeSchedule ? computeScheduledAt(delay, customDateTime) : undefined,
    };
  }

  async function handleSend() {
    setBusy('send');
    setError('');
    try {
      await onSend(buildData({ includeSchedule: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDraft() {
    setBusy('draft');
    setError('');
    try {
      await onSaveDraft(buildData());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save draft failed');
    } finally {
      setBusy(null);
    }
  }

  if (formats.length === 0 || templates.length === 0) {
    return <p className="dash-page__muted">Create at least one Email Format and Template before composing.</p>;
  }

  return (
    <div className="message-composer">
      {showTo && (
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          <span className="field-label">To</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
        </label>
      )}
      {showSubject && (
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          <span className="field-label">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
      )}

      <div className="message-composer__toolbar">
        <BrandComposeControls
          formats={formats}
          templates={templates}
          formatId={formatId}
          onFormatIdChange={setFormatId}
          templateId={templateId}
          onTemplateIdChange={setTemplateId}
          includeBrand={includeBrand}
          onIncludeBrandChange={setIncludeBrand}
          includeSignature={includeSignature}
          onIncludeSignatureChange={setIncludeSignature}
        />
        <label>
          <span className="field-label">Gutter width</span>
          <select value={gutterOverride} onChange={(e) => setGutterOverride(e.target.value)}>
            {GUTTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="humanize-panel__review-opt">
          <input type="checkbox" checked={plainTextOnly} onChange={(e) => setPlainTextOnly(e.target.checked)} />
          Send as Plain Text Only
        </label>
        <label className="message-composer__delay">
          <Clock size={14} />
          <select value={delay} onChange={(e) => setDelay(e.target.value as SendDelay)}>
            {DELAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {delay === 'custom' && (
            <input
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
            />
          )}
        </label>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <TipTapEditor content={bodyHtml} onChange={setBodyHtml} />
      </div>

      {error && <p className="dash-page__error">{error}</p>}

      <div className="message-composer__actions">
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => void handleSaveDraft()}>
          {busy === 'draft' ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void handleSend()}>
          {busy === 'send' ? 'Sending…' : sendLabel ?? (delay === 'now' ? 'Send' : 'Schedule send')}
        </button>
      </div>
    </div>
  );
}
