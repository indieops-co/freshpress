import { useState } from 'react';
import UpgradeNotice from '../components/UpgradeNotice';
import { useAuth } from '../context/AuthContext';
import FormatEditor from '../components/email-design/FormatEditor';
import TemplateEditor from '../components/email-design/TemplateEditor';
import ComposeEmail from '../components/email-design/ComposeEmail';
import BrandDefaultsPanel from '../components/email-design/BrandDefaultsPanel';

interface Props {
  siteId: string;
  siteName: string;
}

type Tab = 'formats' | 'templates' | 'compose' | 'defaults';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'formats', label: 'Formats' },
  { id: 'templates', label: 'Templates' },
  { id: 'compose', label: 'Compose' },
  { id: 'defaults', label: 'Brand Defaults' },
];

export default function EmailDesignPage({ siteId, siteName }: Props) {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('formats');

  if (!(auth.features?.emailSystem ?? true)) {
    return (
      <div className="dash-page">
        <UpgradeNotice title="Email Design">
          Branded email formats, reusable templates, and an AI compose flow that match each
          site&apos;s design system.
        </UpgradeNotice>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Email Design — {siteName}</h2>
      <p className="dash-page__muted">
        Fonts, colors, and spacing (Format) are independent of structure (Template). Compose reuses whichever
        Format + Template you pick, with Brand and Signature toggled per email.
      </p>

      <div className="page-tabs" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`page-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'formats' && <FormatEditor siteId={siteId} />}
      {tab === 'templates' && <TemplateEditor siteId={siteId} />}
      {tab === 'compose' && <ComposeEmail siteId={siteId} />}
      {tab === 'defaults' && <BrandDefaultsPanel siteId={siteId} />}
    </div>
  );
}
