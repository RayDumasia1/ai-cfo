"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      router.push("/dashboard");
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
              autoComplete="current-password"
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
            <div className="flex justify-end mt-1.5">
              <a
                href="/auth/forgot-password"
                style={{
                  fontSize: 12,
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
                Forgot password?
              </a>
            </div>
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
            {loading ? "Please wait…" : "Sign In"}
          </button>

          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: "1px solid #D8E2EC",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 12, color: "#6B7A8D", margin: 0 }}>
              Not sure which email you used?{" "}
              <a
                href="mailto:hello@elidan.ai"
                style={{ color: "#2CA6A4", textDecoration: "none" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.textDecoration = "underline")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.textDecoration = "none")
                }
              >
                Contact us at hello@elidan.ai
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
