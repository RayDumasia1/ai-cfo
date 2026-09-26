"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  ChevronRight,
  CheckCircle2,
  Clock,
  Lock,
  Loader2,
  MessageSquare,
  Sparkles,
  TrendingUp,
  RefreshCw,
  GitCompare,
  Mail,
  Zap,
  Users,
  Phone,
  FileText,
  Building2,
} from "lucide-react";
import type { Feature, FeatureTier } from "@/lib/featureGates";
import {
  GROWTH_AVAILABLE,
  ADVISORY_AVAILABLE,
  isFeatureComingSoon,
} from "@/lib/launchConfig";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: Feature;
  currentTier: FeatureTier;
  userEmail?: string;
  upgradeMessage: {
    title: string;
    message: string;
    upgrade_to: FeatureTier;
  };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const featureNames: Record<string, string> = {
  ask_cfo: "Ask your CFO",
  ai_insights: "AI Insights",
  quickbooks_sync: "QuickBooks Sync",
  xero_sync: "Xero Sync",
  forecasting: "Cash Flow Forecasting",
  weekly_summary: "Weekly CFO Email",
  cfo_call: "CFO Call",
  team_seats: "Team Seats",
  custom_reports: "Custom Reports",
  bank_sync: "Bank Connection",
  action_tracker_v2: "Smart Actions",
  action_tracker_v3: "AI Actions",
};

const FEATURE_ICONS: Record<Feature, React.ElementType> = {
  ask_cfo: MessageSquare,
  ai_insights: Sparkles,
  weekly_summary: Mail,
  quickbooks_sync: RefreshCw,
  xero_sync: RefreshCw,
  forecasting: TrendingUp,
  scenario_comparison: GitCompare,
  action_prefill: Zap,
  action_recommendations: Zap,
  action_tracker_v3: Users,
  team_seats: Users,
  cfo_call: Phone,
  custom_reports: FileText,
  bank_sync: Building2,
};

const TIER_HIGHLIGHTS: Record<FeatureTier, string[]> = {
  suspended: [],
  starter: [],
  core: [
    "Ask your CFO financial questions with AI",
    "Connect QuickBooks or Xero automatically",
  ],
  growth: [
    "Unlimited AI insights and Ask CFO",
    "12-month cash flow forecasting",
    "Side-by-side scenario comparison",
  ],
  advisory: [
    "Monthly 60-minute CFO strategy call",
    "Team seats (up to 3 users)",
    "Board-ready custom reports",
  ],
};

function capitaliseTier(tier: FeatureTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function UpgradeModal({
  isOpen,
  onClose,
  feature,
  currentTier,
  userEmail,
  upgradeMessage,
}: UpgradeModalProps) {
  const prefersReducedMotion = useRef(false);
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isTierComingSoon =
    (upgradeMessage.upgrade_to === "growth" && !GROWTH_AVAILABLE) ||
    (upgradeMessage.upgrade_to === "advisory" && !ADVISORY_AVAILABLE);

  const isComingSoon = isFeatureComingSoon(feature);
  const featureDisplayName = featureNames[feature] ?? feature;

  const [notifyEmail, setNotifyEmail] = useState(userEmail ?? "");
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notifySubmitted, setNotifySubmitted] = useState(false);
  const [alreadyNotified, setAlreadyNotified] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    const stored = window.localStorage.getItem(`elidan_notified_${feature}`);
    setAlreadyNotified(!!stored);
    setNotifySubmitted(false);
    setNotifyEmail(userEmail ?? "");
    setEmailError(null);
    setSubmitError(null);
  }, [isOpen, feature, userEmail]);

  async function handleNotifySubmit() {
    if (!EMAIL_REGEX.test(notifyEmail)) {
      setEmailError("Please enter a valid email");
      return;
    }
    setEmailError(null);
    setSubmitError(null);
    setNotifyLoading(true);
    try {
      const res = await fetch("/api/notify-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: notifyEmail, feature }),
      });
      if (!res.ok) throw new Error("Request failed");
      window.localStorage.setItem(`elidan_notified_${feature}`, "true");
      setNotifySubmitted(true);
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setNotifyLoading(false);
    }
  }

  async function handleUpgrade() {
    setLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey: upgradeMessage.upgrade_to,
          mode: "subscription",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Could not start checkout"
      );
      setLoading(false);
    }
  }

  useEffect(() => {
    prefersReducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const Icon = FEATURE_ICONS[feature] ?? Lock;
  const highlights = TIER_HIGHLIGHTS[upgradeMessage.upgrade_to] ?? [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10,26,47,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: prefersReducedMotion.current
          ? undefined
          : "upgradeModalFadeIn 200ms ease-out",
      }}
    >
      <style>{`
        @keyframes upgradeModalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          maxWidth: 480,
          width: "90vw",
          padding: 32,
          boxShadow: "0 8px 32px rgba(10,26,47,0.12)",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#6B7A8D",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
            borderRadius: 6,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#344150")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#6B7A8D")
          }
        >
          <X size={18} />
        </button>

        {isComingSoon ? (
          <>
            {/* Icon block */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  backgroundColor: "rgba(44,166,164,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Clock size={22} color="#2CA6A4" />
              </div>
            </div>

            {/* Coming soon badge */}
            <div
              style={{ display: "flex", justifyContent: "center", marginTop: 16, marginBottom: 8 }}
            >
              <span
                style={{
                  backgroundColor: "#F4F7FA",
                  border: "1px solid #D8E2EC",
                  borderRadius: 20,
                  padding: "4px 14px",
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#6B7A8D",
                }}
              >
                Coming soon
              </span>
            </div>

            {/* Title */}
            <p
              style={{
                fontSize: 20,
                fontWeight: 500,
                color: "#0A1A2F",
                textAlign: "center",
                margin: 0,
              }}
            >
              {featureDisplayName}
            </p>

            {/* Sub-text */}
            <p
              style={{
                fontSize: 14,
                fontWeight: 400,
                color: "#6B7A8D",
                textAlign: "center",
                lineHeight: 1.6,
                marginTop: 8,
                marginBottom: 0,
                maxWidth: 340,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              This feature is in development and will be available to Core
              subscribers within 90 days. Enter your email to be notified
              when it launches.
            </p>

            {/* Notify me form */}
            {notifySubmitted || alreadyNotified ? (
              <div style={{ marginTop: 24, textAlign: "center" }}>
                <CheckCircle2
                  size={32}
                  color="#22C55E"
                  style={{ margin: "0 auto 12px", display: "block" }}
                />
                <p
                  style={{
                    fontSize: 16,
                    fontWeight: 500,
                    color: "#0A1A2F",
                    margin: 0,
                  }}
                >
                  You&apos;re on the list ✓
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "#6B7A8D",
                    lineHeight: 1.5,
                    marginTop: 8,
                    marginBottom: 0,
                  }}
                >
                  {notifySubmitted
                    ? `We'll email you at ${notifyEmail} as soon as ${featureDisplayName} is available.`
                    : `You're already on the list. We'll email you when ${featureDisplayName} launches.`}
                </p>
                <button
                  onClick={onClose}
                  style={{
                    width: "100%",
                    height: 40,
                    backgroundColor: "transparent",
                    border: "1.5px solid #D8E2EC",
                    color: "#344150",
                    fontSize: 14,
                    borderRadius: 10,
                    marginTop: 20,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.borderColor =
                      "#2CA6A4")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.borderColor =
                      "#D8E2EC")
                  }
                >
                  Close
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 24 }}>
                <input
                  type="email"
                  value={notifyEmail}
                  onChange={(e) => {
                    setNotifyEmail(e.target.value);
                    setEmailError(null);
                  }}
                  placeholder="your@email.com"
                  style={{
                    width: "100%",
                    height: 44,
                    border: emailFocused
                      ? "1.5px solid #2CA6A4"
                      : emailError
                        ? "1.5px solid #E84545"
                        : "1.5px solid #D8E2EC",
                    boxShadow: emailFocused
                      ? "0 0 0 3px rgba(44,166,164,0.12)"
                      : "none",
                    borderRadius: 10,
                    fontSize: 14,
                    color: "#0A1A2F",
                    padding: "0 14px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
                {emailError && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#E84545",
                      marginTop: 6,
                      marginBottom: 0,
                    }}
                  >
                    {emailError}
                  </p>
                )}
                <button
                  onClick={handleNotifySubmit}
                  disabled={notifyLoading}
                  style={{
                    width: "100%",
                    height: 44,
                    backgroundColor: "#2CA6A4",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 500,
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    cursor: notifyLoading ? "not-allowed" : "pointer",
                    opacity: notifyLoading ? 0.7 : 1,
                  }}
                >
                  {notifyLoading ? (
                    <>
                      <Loader2
                        size={16}
                        color="#FFFFFF"
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                      Saving...
                    </>
                  ) : (
                    "Notify me when available"
                  )}
                </button>
                {submitError && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#E84545",
                      textAlign: "center",
                      marginTop: 8,
                      marginBottom: 0,
                    }}
                  >
                    {submitError}
                  </p>
                )}
                <p
                  style={{
                    fontSize: 11,
                    color: "#6B7A8D",
                    textAlign: "center",
                    fontStyle: "italic",
                    marginTop: 12,
                    marginBottom: 0,
                  }}
                >
                  We&apos;ll only use your email to notify you about this
                  feature.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
        {/* Icon block */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              backgroundColor: "rgba(44,166,164,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={24} color="#2CA6A4" />
          </div>
        </div>

        {/* Title */}
        <p
          style={{
            fontSize: 20,
            fontWeight: 500,
            color: "#0A1A2F",
            textAlign: "center",
            marginTop: 16,
            marginBottom: 0,
          }}
        >
          {upgradeMessage.title}
        </p>

        {/* Message */}
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            color: "#6B7A8D",
            textAlign: "center",
            lineHeight: 1.6,
            marginTop: 8,
            marginBottom: 0,
            maxWidth: 340,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {upgradeMessage.message}
        </p>

        {/* Tier comparison strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            backgroundColor: "#F4F7FA",
            borderRadius: 10,
            padding: "12px 16px",
            marginTop: 24,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#344150",
              backgroundColor: "#FFFFFF",
              border: "1px solid #D8E2EC",
              borderRadius: 6,
              padding: "4px 10px",
            }}
          >
            Your plan: {capitaliseTier(currentTier)}
          </span>
          <ChevronRight size={16} color="#6B7A8D" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#FFFFFF",
              backgroundColor: "#2CA6A4",
              borderRadius: 6,
              padding: "4px 10px",
            }}
          >
            {capitaliseTier(upgradeMessage.upgrade_to)}
          </span>
        </div>

        {/* Feature highlights */}
        {highlights.length > 0 && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {highlights.map((text) => (
              <div
                key={text}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <CheckCircle2 size={14} color="#2CA6A4" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#344150" }}>{text}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA button */}
        {isTierComingSoon ? (
          <button
            disabled
            style={{
              width: "100%",
              height: 44,
              backgroundColor: "#F4F7FA",
              color: "#6B7A8D",
              border: "1px solid #D8E2EC",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: "not-allowed",
              marginTop: 24,
            }}
          >
            Coming soon
          </button>
        ) : (
          <button
            onClick={handleUpgrade}
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
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
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
            {loading ? (
              <>
                <Loader2
                  size={16}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Redirecting to checkout...
              </>
            ) : (
              `Upgrade to ${capitaliseTier(upgradeMessage.upgrade_to)}`
            )}
          </button>
        )}

        {checkoutError && (
          <p
            style={{
              fontSize: 13,
              color: "#DC2626",
              textAlign: "center",
              marginTop: 8,
              marginBottom: 0,
            }}
          >
            {checkoutError}
          </p>
        )}
          </>
        )}

        {/* Maybe later */}
        {!isComingSoon && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                fontSize: 13,
                color: "#6B7A8D",
                cursor: "pointer",
                textDecoration: "none",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.textDecoration =
                  "underline")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.textDecoration =
                  "none")
              }
            >
              Maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
