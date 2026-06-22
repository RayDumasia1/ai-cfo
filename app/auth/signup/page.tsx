"use client";

import { useState } from "react";
import { Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  border: "1.5px solid #D8E2EC",
  borderRadius: 10,
  fontSize: 14,
  color: "#0A1A2F",
  padding: "0 40px 0 12px",
  outline: "none",
  boxSizing: "border-box",
  backgroundColor: "#FFFFFF",
  transition: "border-color 150ms, box-shadow 150ms",
};

const emailInputStyle: React.CSSProperties = {
  ...inputStyle,
  padding: "0 12px",
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

function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "#2CA6A4";
  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(44,166,164,0.12)";
}

function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "#D8E2EC";
  e.currentTarget.style.boxShadow = "none";
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBannerError(null);

    const newErrors: FieldErrors = {};
    if (!email) {
      newErrors.email = "Please enter your email";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }
    if (!password) {
      newErrors.password = "Please enter a password";
    } else if (password.length < 8) {
      newErrors.password = "Password must be at least 8 characters";
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        },
      });

      if (error) {
        if (/already registered/i.test(error.message)) {
          setBannerError("An account with this email already exists. Sign in instead.");
        } else if (/rate limit/i.test(error.message)) {
          setBannerError("Too many attempts. Please wait a moment and try again.");
        } else {
          setBannerError(error.message);
        }
        setLoading(false);
        return;
      }

      router.push(`/auth/verify?email=${encodeURIComponent(email)}`);
    } catch {
      setBannerError("Network error — please try again");
      setLoading(false);
    }
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

        <p
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: "#0A1A2F",
            textAlign: "center",
            marginTop: 4,
            marginBottom: 4,
          }}
        >
          Create your account
        </p>
        <p
          style={{
            fontSize: 13,
            color: "#6B7A8D",
            textAlign: "center",
            marginTop: 0,
            marginBottom: 24,
          }}
        >
          Start seeing your business finances clearly.
        </p>

        {bannerError && (
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
            {bannerError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor="email" style={labelStyle}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                ...emailInputStyle,
                borderColor: errors.email ? "#E84545" : "#D8E2EC",
              }}
              onFocus={focusInput}
              onBlur={blurInput}
            />
            {errors.email && (
              <p style={{ fontSize: 12, color: "#E84545", marginTop: 4, marginBottom: 0 }}>
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" style={labelStyle}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: errors.password ? "#E84545" : "#D8E2EC",
                }}
                onFocus={focusInput}
                onBlur={blurInput}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  color: "#6B7A8D",
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password ? (
              <p style={{ fontSize: 12, color: "#E84545", marginTop: 4, marginBottom: 0 }}>
                {errors.password}
              </p>
            ) : (
              <p style={{ fontSize: 11, color: "#6B7A8D", marginTop: 4, marginBottom: 0 }}>
                Minimum 8 characters
              </p>
            )}
          </div>

          <div>
            <label htmlFor="confirm-password" style={labelStyle}>
              Confirm Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: errors.confirmPassword ? "#E84545" : "#D8E2EC",
                }}
                onFocus={focusInput}
                onBlur={blurInput}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                title={showConfirmPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  color: "#6B7A8D",
                }}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p style={{ fontSize: 12, color: "#E84545", marginTop: 4, marginBottom: 0 }}>
                {errors.confirmPassword}
              </p>
            )}
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => {
              if (!loading)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3DBFBD";
            }}
            onMouseLeave={(e) => {
              if (!loading)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2CA6A4";
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account →"
            )}
          </button>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
            <Lock size={11} color="#6B7A8D" />
            <span style={{ fontSize: 11, color: "#6B7A8D" }}>Secured by 256-bit encryption</span>
          </div>
        </form>

        <div style={{ borderTop: "1px solid #D8E2EC", marginTop: 24, paddingTop: 16, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0 }}>
            Already have an account?{" "}
            <a
              href="/auth"
              style={{ color: "#2CA6A4", textDecoration: "none", fontWeight: 500 }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              Sign in →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
