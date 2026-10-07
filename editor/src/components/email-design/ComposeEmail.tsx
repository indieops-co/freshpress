import { useEffect, useState } from 'react';
import { api, type EmailFormat, type EmailTemplate, type SiteEmailBrandDefaults } from '../../api';
import TipTapEditor from '../blog/TipTapEditor';
import BrandComposeControls from './BrandComposeControls';

interface Props {
  siteId: string;
}

export default function ComposeEmail({ siteId }: Props) {
  const [formats, setFormats] = useState<EmailFormat[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  const [formatId, setFormatId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [includeBrand, setIncludeBrand] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [bodyHtml, setBodyHtml] = useState('<p></p>');
  const [to, setTo] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.listEmailFormats(siteId), api.listEmailTemplates(siteId), api.getEmailBrandDefaults(siteId)])
      .then(([fRes, tRes, dRes]: [
        { formats: EmailFormat[] },
        { templates: EmailTemplate[] },
        { brandDefaults: SiteEmailBrandDefaults }
      ]) => {
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
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  useEffect(() => {
    if (!formatId || !templateId) return;
    const timer = setTimeout(() => {
      api
        .previewComposeEmail(siteId, {
          formatId,
          templateId,
          subject: subject || '(no subject)',
          previewText: previewText || undefined,
          bodyHtml,
          includeBrand,
          includeSignature,
        })
        .then((res) => setPreviewHtml(res.html))
        .catch((e) => setError(e instanceof Error ? e.message : 'Preview failed'));
    }, 400);
    return () => clearTimeout(timer);
  }, [siteId, formatId, templateId, subject, previewText, bodyHtml, includeBrand, includeSignature]);

  async function handleSendTest() {
    if (!to.trim() || !formatId || !templateId) return;
    setSending(true);
    setError('');
    try {
      await api.sendComposeEmail(siteId, {
        to: to.trim(),
        formatId,
        templateId,
        subject: subject || '(no subject)',
        previewText: previewText || undefined,
        bodyHtml,
        includeBrand,
        includeSignature,
      });
      setStatus('Sent!');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p className="dash-page__muted">Loading…</p>;
  if (formats.length === 0 || templates.length === 0) {
    return <p className="dash-page__muted">Create at least one Email Format and Template before composing.</p>;
  }

  return (
    <div className="design-step__layout">
      <div className="design-step__themes">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Compose</h3>

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

        <label style={{ marginTop: '0.75rem', display: 'block' }}>
          <span className="field-label">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Preview text</span>
          <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
        </label>

        <div style={{ marginTop: '0.75rem' }}>
          <span className="field-label">Body</span>
          <TipTapEditor content={bodyHtml} onChange={setBodyHtml} />
        </div>

        <label style={{ marginTop: '0.75rem', display: 'block' }}>
          <span className="field-label">Send test to</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
        </label>
        <button type="button" style={{ marginTop: '0.5rem' }} disabled={sending} onClick={() => void handleSendTest()}>
          {sending ? 'Sending…' : 'Send test'}
        </button>
        {status && <p className="status-ok">{status}</p>}
        {error && <p className="dash-page__error">{error}</p>}
      </div>

      <div className="design-step__preview">
        <h4 style={{ margin: '0 0 0.5rem' }}>Live preview</h4>
        <iframe
          title="Compose preview"
          srcDoc={previewHtml}
          style={{ width: '100%', height: '600px', border: '1px solid var(--border)', borderRadius: '8px', background: '#fff' }}
        />
      </div>
    </div>
  );
}
