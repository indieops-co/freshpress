/**
 * Free-build stand-ins for the '@paid' exports (see editor/vite.config.ts). Every
 * export must keep signature parity with src/paid/editor/index.tsx — this file is
 * also the tsconfig `paths` target for '@paid', so it is the type-level contract
 * for both build variants.
 */
export function BrandResearchSection(_props: { siteId: string }) {
  return (
    <section className="panel settings-card settings-card--full" id="brand-research">
      <h3>Deep Brand Research</h3>
      <p className="dash-page__muted">
        Build a research-grade brand foundation — customer avatar, offer brief, necessary
        customer beliefs, and simulated customer interviews — that automatically sharpens
        every social post and page this site generates.{' '}
        <strong>Available on paid plans.</strong>
      </p>
    </section>
  );
}
