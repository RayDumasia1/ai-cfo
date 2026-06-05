"use client";

import { Suspense, useState } from "react";
import { Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import SessionExpiredAlert from "@/app/components/SessionExpiredAlert";

function RisingColumnMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="4" y="24" width="8" height="12" rx="2" fill="#2CA6A4" />
      <rect x="16" y="16" width="8" height="20" rx="2" fill="#2CA6A4" />
      <rect x="28" y="8" width="8" height="28" rx="2" fill="#2CA6A4" />
      <line x1="4" y1="24" x2="36" y2="8" stroke="#D4AF7F" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  border: "1.5px solid #D8E2EC",
  borderRadius: 10,
  fontSize: 14,
  color: "#0A1A2F",
  padding: "0 12px",
  outline: "none",
  boxSizing: "border-box",
  backgroundColor: "#FFFFFF",
  transition: "border-color 150ms, box-shadow 150ms",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "#344150",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 6,
};

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") as
    | "session_expired"
    | "logged_out"
    | null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign in failed");
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Network error — please try again");
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F4F7FA",
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #D8E2EC",
          borderRadius: 16,
          boxShadow: "0 4px 16px rgba(10,26,47,0.10)",
          padding: 40,
          maxWidth: 400,
          width: "90vw",
        }}
      >
        {/* Logo mark + wordmark */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <RisingColumnMark />
            <p
              style={{ fontSize: 20, fontWeight: 500, color: "#0A1A2F", margin: 0 }}
            >
              Elidan{" "}
              <span style={{ fontWeight: 300, color: "#2CA6A4" }}>AI</span>
            </p>
          </div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: "#6B7A8D",
              margin: 0,
            }}
          >
            Financial Intelligence
          </p>
        </div>

        {/* Session info banner */}
        <SessionExpiredAlert reason={reason} />

        {/* Auth error banner */}
        {error && (
          <div
            style={{
              backgroundColor: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
              color: "#344150",
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div>
            <label htmlFor="email" style={labelStyle}>
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
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#2CA6A4";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(44,166,164,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#D8E2EC";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          <div>
            <label htmlFor="password" style={labelStyle}>
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
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#2CA6A4";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(44,166,164,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#D8E2EC";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <a
                href="/auth/forgot-password"
                style={{ fontSize: 12, color: "#2CA6A4", textDecoration: "none" }}
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

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              height: 44,
              backgroundColor: loading ? "#6B7A8D" : "#2CA6A4",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background-color 150ms",
            }}
            onMouseEnter={(e) => {
              if (!loading)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "#3DBFBD";
            }}
            onMouseLeave={(e) => {
              if (!loading)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "#2CA6A4";
            }}
          >
            {loading ? "Please wait…" : "Sign In"}
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 }}>
            <Lock size={11} color="#6B7A8D" />
            <span style={{ fontSize: 11, color: "#6B7A8D" }}>Secured by 256-bit encryption</span>
          </div>
        </form>

        <div style={{ marginTop: 20, textAlign: "center" }}>
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
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
