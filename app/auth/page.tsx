"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Tab = "signin" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (tab === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
      } else {
        router.push("/dashboard");
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setSignupSuccess(true);
      }
    }

    setLoading(false);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "var(--cloud)" }}
    >
      <div
        className="w-full max-w-sm bg-surface"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-md)",
          padding: "2rem",
        }}
      >
        {/* Logo */}
        <div className="mb-6 text-center">
          <p className="text-xl font-medium" style={{ color: "var(--ink)" }}>
            Elidan AI
          </p>
          <p
            className="mt-1 text-xs font-light tracking-widest uppercase"
            style={{ color: "var(--dim)" }}
          >
            Financial Intelligence
          </p>
        </div>

        {/* Tabs */}
        <div
          className="flex mb-6"
          style={{
            borderBottom: "1px solid var(--line)",
          }}
        >
          {(["signin", "signup"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
                setSignupSuccess(false);
              }}
              className="flex-1 py-2 text-sm font-medium transition-colors"
              style={{
                borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
                color: tab === t ? "var(--teal)" : "var(--dim)",
                marginBottom: "-1px",
              }}
            >
              {t === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {signupSuccess ? (
          <div
            className="text-sm text-center"
            style={{ color: "var(--ink)" }}
          >
            <p className="font-medium">Check your email</p>
            <p className="mt-2 font-light" style={{ color: "var(--dim)" }}>
              We&apos;ve sent a confirmation link to <strong>{email}</strong>.
              Click it to activate your account, then sign in.
            </p>
            <button
              onClick={() => {
                setTab("signin");
                setSignupSuccess(false);
              }}
              className="mt-4 text-sm font-medium"
              style={{ color: "var(--teal)" }}
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--ink)" }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border px-4 py-2.5 text-sm outline-none transition"
                style={{
                  borderRadius: "var(--radius-sm)",
                  borderColor: "var(--line)",
                  backgroundColor: "var(--cloud)",
                  color: "var(--ink)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "var(--teal)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--line)")
                }
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--ink)" }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete={
                  tab === "signin" ? "current-password" : "new-password"
                }
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border px-4 py-2.5 text-sm outline-none transition"
                style={{
                  borderRadius: "var(--radius-sm)",
                  borderColor: "var(--line)",
                  backgroundColor: "var(--cloud)",
                  color: "var(--ink)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "var(--teal)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--line)")
                }
              />
            </div>

            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-sm font-medium text-white transition"
              style={{
                borderRadius: "var(--radius-sm)",
                backgroundColor: loading ? "var(--dim)" : "var(--teal)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading
                ? "Please wait…"
                : tab === "signin"
                ? "Sign In"
                : "Create Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
