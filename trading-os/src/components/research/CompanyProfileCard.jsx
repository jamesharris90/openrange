"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function toText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function summarizeDescription(value, maxLength = 420) {
  const text = toText(value);
  if (!text) {
    return null;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function InfoPill({ label, value }) {
  if (!value) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  );
}

export default function CompanyProfileCard({ profile, symbol }) {
  const companyName = toText(profile?.company_name) || symbol;
  const sector = toText(profile?.sector);
  const industry = toText(profile?.industry);
  const exchange = toText(profile?.exchange);
  const country = toText(profile?.country);
  const website = toText(profile?.website);
  const description = summarizeDescription(profile?.description);

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>Company Information</CardTitle>
        <CardDescription>
          Cached business profile with FMP-backed description when available.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">{symbol}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-50">{companyName}</div>
          <div className="mt-3 text-sm leading-7 text-slate-300">
            {description || "Company profile space is in place. Description will populate from the cached company profile or FMP when present."}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoPill label="Sector" value={sector || "—"} />
          <InfoPill label="Industry" value={industry || "—"} />
          <InfoPill label="Exchange" value={exchange || "—"} />
          <InfoPill label="Country" value={country || "—"} />
        </div>

        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/50 hover:bg-cyan-500/15"
          >
            Visit company website
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}