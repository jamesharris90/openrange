import { cn } from "@/lib/utils";

export function ConfidenceMeter({ value }: { value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Confidence</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div
          className={cn(
            "h-full transition-all",
            value >= 80 ? "bg-bull" : value >= 60 ? "bg-accent" : "bg-bear"
          )}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}
