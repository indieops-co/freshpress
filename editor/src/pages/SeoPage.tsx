import SeoPromptsPanel from '../components/SeoPromptsPanel';

interface Props {
  siteId: string;
}

export default function SeoPage({ siteId }: Props) {
  return (
    <div className="dash-page">
      <h2 className="dash-page__title">SEO</h2>
      <p className="dash-page__muted">
        HeadCheck Next.js prompts and advanced SERP recipes — copy to your agent. Connect On-Page.ai MCP
        in Cursor for recipe execution.
      </p>
      <SeoPromptsPanel siteId={siteId} />
    </div>
  );
}
