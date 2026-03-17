export function ProbabilityBar({ value }: { value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Probability</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }).map((_, index) => {
          const active = index < Math.round(value / 10);
          return (
            <div
              key={index}
              className={`h-2 rounded-sm ${active ? "bg-accent" : "bg-muted"}`}
            />
          );
        })}
      </div>
    </div>
  );
}
