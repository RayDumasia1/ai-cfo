"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const { error: sbError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }
      );

      if (sbError) {
        if (sbError.status === 429) {
          setError("Too many requests — please wait a few minutes before trying again.");
        } else {
          setError("Something went wrong — please try again.");
        }
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setLoading(false);
    }
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

        {submitted ? (
          <div className="text-sm text-center">
            <p className="font-medium" style={{ color: "var(--ink)" }}>
              Check your email
            </p>
            <p
              className="mt-2 font-light"
              style={{ color: "var(--dim)", lineHeight: 1.6 }}
            >
              If an account exists for <strong style={{ color: "var(--ink)" }}>{email}</strong>,
              you&apos;ll receive a reset link shortly.
            </p>
            <a
              href="/auth"
              className="mt-4 block text-sm font-medium"
              style={{ color: "#2CA6A4", textDecoration: "none" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.textDecoration = "underline")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.textDecoration = "none")
              }
            >
              Back to sign in
            </a>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1
                className="text-base font-semibold"
                style={{ color: "var(--ink)", margin: 0 }}
              >
                Reset your password
              </h1>
              <p
                className="mt-1.5 text-sm font-light"
                style={{ color: "var(--dim)", lineHeight: 1.6 }}
              >
                Enter your email address and we&apos;ll send you a link to reset
                your password.
              </p>
            </div>

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

              {error && <p className="text-xs text-red-500">{error}</p>}

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
                {loading ? "Please wait…" : "Send reset link"}
              </button>

              <div className="text-center">
                <a
                  href="/auth"
                  style={{
                    fontSize: 13,
                    color: "#2CA6A4",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.textDecoration = "underline")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.textDecoration = "none")
                  }
                >
                  Back to sign in
                </a>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
