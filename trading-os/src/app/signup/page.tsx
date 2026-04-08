"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api/client";

function SignupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, initialized, isAuthenticated } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    const next = searchParams.get("next");
    return next && next.startsWith("/") && next !== "/login" && next !== "/signup" ? next : "/dashboard";
  }, [searchParams]);

  useEffect(() => {
    if (!initialized || !isAuthenticated) return;
    router.replace("/dashboard");
  }, [initialized, isAuthenticated, router]);

  if (initialized && isAuthenticated) {
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const registerResponse = await apiFetch("/api/users/register", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
        }),
      });

      const registerPayload = (await registerResponse.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!registerResponse.ok || registerPayload.success === false) {
        setError(registerPayload.error || "Sign up failed.");
        return;
      }

      const loginResponse = await apiFetch("/api/users/login", {
        method: "POST",
        body: JSON.stringify({ identifier: email.trim(), password }),
      });

      const loginPayload = (await loginResponse.json().catch(() => ({}))) as {
        token?: string;
        user?: { username?: string; email?: string; id?: number | string; is_admin?: number | boolean };
        error?: string;
        detail?: string;
      };

      if (!loginResponse.ok || !loginPayload.token) {
        setError(loginPayload.error || loginPayload.detail || "Account created, but automatic sign in failed.");
        return;
      }

      localStorage.setItem("token", loginPayload.token);
      login(loginPayload.token, loginPayload.user || null);
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
        <h1 className="text-xl font-semibold text-slate-100">Create account</h1>
        <p className="mt-1 text-sm text-slate-400">Create your OpenRange access and continue to the platform</p>

        <label className="mt-5 block text-sm text-slate-300">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            autoComplete="username"
            required
          />
        </label>

        <label className="mt-4 block text-sm text-slate-300">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            autoComplete="email"
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
            autoComplete="new-password"
            required
          />
        </label>

        <label className="mt-4 block text-sm text-slate-300">
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            autoComplete="new-password"
            required
          />
        </label>

        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 disabled:opacity-60"
        >
          {submitting ? "Creating account..." : "Sign up"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account? {" "}
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="text-emerald-400 hover:text-emerald-300">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-slate-300">Loading sign up...</main>}>
      <SignupPageContent />
    </Suspense>
  );
}