"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCatalysts } from "@/lib/queries";

const impactVariant = {
  low: "default",
  medium: "accent",
  high: "success",
} as const;

export function CatalystFeed() {
  const { data } = useQuery({
    queryKey: ["catalysts"],
    queryFn: getCatalysts,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catalyst Scanner Feed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.map((item, index) => (
          <div key={`${item.ticker}-${index}`} className="rounded border border-border bg-background p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="font-mono text-xs text-cyan-200">{item.ticker}</p>
              <Badge variant={impactVariant[item.impact]}>{item.impact.toUpperCase()}</Badge>
            </div>
            <p className="text-sm leading-5 text-foreground">{item.catalyst}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
