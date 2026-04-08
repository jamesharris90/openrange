"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isNullDisplay } from "@/components/research/formatters";
import { cn } from "@/lib/utils";

function toneClass(tone) {
  if (tone === "positive") {
    return "text-emerald-300";
  }

  if (tone === "negative") {
    return "text-rose-300";
  }

  if (tone === "accent") {
    return "text-cyan-300";
  }

  return "text-slate-100";
}

export default function MetricGridCard({ title, description, items, columns = "md:grid-cols-2 xl:grid-cols-4" }) {
  const visibleItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (visibleItems.length === 0 || visibleItems.every((item) => isNullDisplay(item?.value))) {
    return null;
  }

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn("grid gap-3", columns)}>
        {visibleItems.map((item) => {
          const isEmpty = isNullDisplay(item?.value);

          return (
          <div
            key={item.label}
            className={cn(
              "rounded-2xl border border-slate-800/70 bg-slate-950/40 p-3 transition",
              isEmpty && "border-slate-800/40 bg-slate-950/20"
            )}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
            <div className={cn("mt-2 text-xl font-semibold", isEmpty ? "text-slate-500" : toneClass(item.tone))}>{item.value}</div>
            {item.detail ? <div className={cn("mt-1 text-sm", isEmpty ? "text-slate-600" : "text-slate-500")}>{item.detail}</div> : null}
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}