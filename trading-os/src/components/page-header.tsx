import { Badge } from "@/components/ui/badge";

export function PageHeader({
  title,
  description,
  label,
}: {
  title: string;
  description: string;
  label?: string;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {label ? <Badge variant="accent">{label}</Badge> : null}
    </div>
  );
}
