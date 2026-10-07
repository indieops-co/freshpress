interface Props {
  title: string;
  description: string;
  children?: React.ReactNode;
}

export default function AdminPage({ title, description, children }: Props) {
  return (
    <div className="dash-page">
      <h2 className="dash-page__title">{title}</h2>
      <p className="dash-page__muted">{description}</p>
      <div className="panel dash-placeholder">{children}</div>
    </div>
  );
}
