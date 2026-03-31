import { API_BASE } from "@/lib/apiBase";

export const dynamic = "force-dynamic";

function buildForwardHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const apiKey = req.headers.get("x-api-key") || process.env.PROXY_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = url.searchParams.get("symbols") || "";
  const search = symbols ? `?symbols=${encodeURIComponent(symbols)}` : "";
  const backendUrl = `${API_BASE}/api/fmp/quotes${search}`;

  const res = await fetch(backendUrl, {
    method: "GET",
    headers: buildForwardHeaders(req),
    cache: "no-store",
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
