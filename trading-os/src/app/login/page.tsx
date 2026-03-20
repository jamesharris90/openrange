"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/context/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

console.log("API BASE:", API_BASE);

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, initialized, isAuthenticated } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    const next = searchParams.get("next");
    return next && next.startsWith("/") ? next : "/trading-terminal";
  }, [searchParams]);

  useEffect(() => {
    if (!initialized || !isAuthenticated) return;
    router.replace("/trading-terminal");
  }, [initialized, isAuthenticated, router]);

  if (initialized && isAuthenticated) {
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        token?: string;
        user?: { username?: string; email?: string; id?: number | string };
        error?: string;
        detail?: string;
      };

      if (!response.ok || !payload.token) {
        setError(payload.error || payload.detail || "Login failed.");
        return;
      }

      localStorage.setItem("token", payload.token);
      login(payload.token, payload.user || null);
      router.replace(nextPath);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-panel p-6">
        <h1 className="text-xl font-semibold text-slate-100">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Access the OpenRange trading terminal</p>

        <label className="mt-5 block text-sm text-slate-300">
          Username or email
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            autoComplete="username"
            required
          />
        </label>

        <label className="mt-4 block text-sm text-slate-300">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 disabled:opacity-60"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-slate-300">Loading sign in...</main>}>
      <LoginPageContent />
    </Suspense>
  );
}
