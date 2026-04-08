interface DomainPlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
}

export function DomainPlaceholder({ eyebrow, title, description, bullets }: DomainPlaceholderProps) {
  return (
    <div className="ai-grid ai-gap-4">
      <section className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-6 ai-shadow-sm">
        <div className="ai-text-xs ai-font-semibold ai-uppercase ai-tracking-[0.2em] ai-text-muted-foreground">{eyebrow}</div>
        <h3 className="ai-mt-2 ai-text-2xl ai-font-semibold ai-text-card-foreground">{title}</h3>
        <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">{description}</p>
      </section>

      <section className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-5 ai-shadow-sm">
        <div className="ai-text-sm ai-font-semibold ai-text-card-foreground">Planned Surface</div>
        <ul className="ai-domain-list ai-mt-2">
          {bullets.map((bullet) => (
            <li key={bullet} className="ai-text-sm ai-leading-6 ai-text-muted-foreground">
              {bullet}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}