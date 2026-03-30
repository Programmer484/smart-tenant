"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [confirmSent, setConfirmSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) { setError(error.message); setLoading(false); return; }

      // If Supabase returned a session, we're good (email confirm disabled)
      if (data.session) {
        router.push("/");
        router.refresh();
        return;
      }
      // Otherwise email confirmation is required
      setConfirmSent(true);
      setLoading(false);
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) { setError(error.message); setLoading(false); return; }
      router.push("/");
      router.refresh();
    }
  }

  if (confirmSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f9f8] px-4">
        <div className="w-full max-w-sm rounded-xl border border-teal-200 bg-teal-50 p-6">
          <p className="text-sm font-medium text-teal-800">Check your inbox</p>
          <p className="mt-1 text-sm text-teal-700">
            We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and sign in.
          </p>
          <button type="button"
            onClick={() => { setConfirmSent(false); setMode("login"); }}
            className="mt-4 text-sm font-medium text-teal-700 hover:underline">
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f9f8] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800 text-white">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1" y="6" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4 6V4.5a4 4 0 0 1 8 0V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <rect x="6.25" y="9.5" width="3.5" height="2.5" rx="0.75" fill="currentColor" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-[#1a2e2a]">RentScreen</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="text-xl font-semibold text-[#1a2e2a]">
            {mode === "signup" ? "Create account" : "Sign in"}
          </h1>

          <input type="email" required placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm text-[#1a2e2a] placeholder:text-[#1a2e2a]/40 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
          <input type="password" required minLength={6} placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm text-[#1a2e2a] placeholder:text-[#1a2e2a]/40 focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button type="submit" disabled={loading || !email.trim() || !password}
            className="w-full rounded-lg bg-teal-800 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            {loading ? "Loading…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          <p className="text-center text-sm text-[#1a2e2a]/50">
            {mode === "signup" ? "Already have an account? " : "No account? "}
            <button type="button"
              onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); }}
              className="font-medium text-teal-700 hover:underline">
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
