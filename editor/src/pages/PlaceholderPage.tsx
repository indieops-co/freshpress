interface Props {
  title: string;
  description: string;
}

export default function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="dash-page">
      <h2 className="dash-page__title">{title}</h2>
      <p className="dash-page__muted">{description}</p>
      <div className="panel dash-placeholder">
        <p>Coming in a later sprint.</p>
      </div>
    </div>
  );
}
