import { useEffect, useState } from 'react';
import { api, type EmailTemplate } from '../../api';

interface Props {
  siteId: string;
  template: EmailTemplate;
  formatId: string | null;
}

const SAMPLE_BODY_HTML =
  '<p>This is a preview of the <strong>body</strong> content — the part authored in the compose editor.</p>';

/** Renders via the real /email-compose/preview endpoint (not a second parallel mock renderer). */
export default function TemplatePreview({ siteId, template, formatId }: Props) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!formatId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .previewComposeEmail(siteId, {
          formatId,
          templateId: template.id,
          subject: 'Sample subject line',
          bodyHtml: SAMPLE_BODY_HTML,
          includeBrand: true,
          includeSignature: true,
        })
        .then((res) => {
          if (!cancelled) setHtml(res.html);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [siteId, template, formatId]);

  if (!formatId) return <p className="dash-page__muted">Create an Email Format first to preview this template.</p>;
  if (error) return <p className="dash-page__error">{error}</p>;

  return (
    <iframe
      title="Template preview"
      srcDoc={html}
      style={{ width: '100%', height: '480px', border: '1px solid var(--border)', borderRadius: '8px', background: '#fff' }}
    />
  );
}
