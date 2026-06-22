"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

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

const RESEND_COOLDOWN = 60;

function VerifyContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [resendState, setResendState] = useState<"idle" | "sent" | "error">("idle");
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleResend() {
    if (cooldown > 0 || !email) return;

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) {
        setResendState("error");
      } else {
        setResendState("sent");
        setTimeout(() => setResendState("idle"), 3000);
      }
    } catch {
      setResendState("error");
    }

    setCooldown(RESEND_COOLDOWN);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
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
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <RisingColumnMark />
            <p style={{ fontSize: 20, fontWeight: 500, color: "#0A1A2F", margin: 0 }}>
              Elidan <span style={{ fontWeight: 300, color: "#2CA6A4" }}>AI</span>
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

        {/* Mail icon */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            backgroundColor: "rgba(44,166,164,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto",
          }}
        >
          <Mail size={28} color="#2CA6A4" />
        </div>

        <p style={{ fontSize: 20, fontWeight: 500, color: "#0A1A2F", textAlign: "center", marginTop: 16, marginBottom: 0 }}>
          Check your email
        </p>

        <p style={{ fontSize: 14, color: "#6B7A8D", textAlign: "center", lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>
          We&apos;ve sent a confirmation link to{" "}
          {email && <span style={{ color: "#2CA6A4", fontWeight: 500 }}>{email}</span>}
          . Click the link to verify your account and choose your plan.
        </p>

        {/* Steps preview */}
        <div
          style={{
            marginTop: 24,
            backgroundColor: "#F4F7FA",
            borderRadius: 10,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 500, color: "#2CA6A4", margin: 0 }}>
            ✓ Account created
          </p>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#0A1A2F", margin: 0 }}>
            → Verify your email
          </p>
          <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0 }}>
            Choose your plan
          </p>
        </div>

        {/* Resend */}
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0 }}>Didn&apos;t receive it?</p>
          {resendState === "sent" ? (
            <p style={{ fontSize: 13, color: "#2CA6A4", marginTop: 4, marginBottom: 0 }}>
              Email resent ✓
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              style={{
                fontSize: 13,
                color: cooldown > 0 ? "#6B7A8D" : "#2CA6A4",
                background: "none",
                border: "none",
                padding: 0,
                marginTop: 4,
                cursor: cooldown > 0 ? "default" : "pointer",
                textDecoration: "none",
              }}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend confirmation email"}
            </button>
          )}
          {resendState === "error" && (
            <p style={{ fontSize: 12, color: "#E84545", marginTop: 4, marginBottom: 0 }}>
              Something went wrong — please try again.
            </p>
          )}
        </div>

        <p style={{ fontSize: 12, color: "#6B7A8D", textAlign: "center", fontStyle: "italic", marginTop: 12, marginBottom: 0 }}>
          Check your spam folder if you don&apos;t see it within a few minutes.
        </p>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <a
            href="/auth"
            style={{ fontSize: 13, color: "#6B7A8D", textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            ← Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
