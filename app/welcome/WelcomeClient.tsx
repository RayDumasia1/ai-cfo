"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Lock, Star } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

type PlanKey = "founding_member" | "starter";

interface Feature {
  label: string;
  comingSoon?: boolean;
}

const FOUNDING_FEATURES: Feature[] = [
  { label: "Financial dashboard & alerts" },
  { label: "Excel & CSV data import" },
  { label: "Ask your CFO (AI Q&A)", comingSoon: true },
  { label: "AI Insights & recommendations", comingSoon: true },
  { label: "QuickBooks sync", comingSoon: true },
  { label: "Weekly CFO email summary" },
  { label: "Priority support & early access" },
];

const STARTER_FEATURES: Feature[] = [
  { label: "Financial dashboard" },
  { label: "Cash position, burn rate & runway" },
  { label: "Proactive alerts" },
  { label: "Excel & CSV data import" },
  { label: "What-If scenario calculator" },
  { label: "Weekly CFO email summary" },
];

type ComingSoonTierKey = "tier_core" | "tier_growth" | "tier_advisory";

interface ComingSoonTier {
  key: ComingSoonTierKey;
  name: string;
  price: number;
  features: Feature[];
}

const COMING_SOON_TIERS: ComingSoonTier[] = [
  {
    key: "tier_core",
    name: "Core",
    price: 99,
    features: [
      { label: "QuickBooks & accounting sync" },
      { label: "Ask your CFO (AI Q&A)" },
      { label: "AI-powered insights" },
      { label: "Smart action pre-fill" },
      { label: "Everything in Starter" },
    ],
  },
  {
    key: "tier_growth",
    name: "Growth",
    price: 199,
    features: [
      { label: "AI recommendations engine" },
      { label: "12-month cash flow forecast" },
      { label: "Unlimited AI usage" },
      { label: "Scenario comparison" },
      { label: "Everything in Core" },
    ],
  },
  {
    key: "tier_advisory",
    name: "Advisory",
    price: 599,
    features: [
      { label: "Dedicated human CFO" },
      { label: "Monthly 60-min strategy call" },
      { label: "Custom board-ready reports" },
      { label: "Team seats & collaboration" },
      { label: "Everything in Growth" },
    ],
  },
];

const CSS = `
.welcome-cards {
  display: flex;
  gap: 16px;
  max-width: 780px;
  margin: 32px auto 0;
  justify-content: center;
}
.welcome-cards--single { max-width: 400px; }
.welcome-card { flex: 1; min-width: 0; padding: 32px; border-radius: var(--radius-lg); }
.welcome-cta {
  width: 100%;
  height: 52px;
  margin-top: 24px;
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: background-color 150ms, color 150ms;
}
.welcome-cta:disabled { cursor: not-allowed; opacity: 0.85; }
.welcome-cta--gold { background: var(--gold); color: var(--navy); border: none; }
.welcome-cta--gold:hover:not(:disabled) { background: #C9A06A; }
.welcome-cta--outline { background: transparent; color: var(--navy); border: 1.5px solid var(--navy); }
.welcome-cta--outline:hover:not(:disabled) { background: var(--navy); color: #FFFFFF; }
.welcome-link { color: var(--teal); text-decoration: none; }
.welcome-link:hover { text-decoration: underline; }
.welcome-soon-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  max-width: 980px;
  margin: 0 auto;
}
.welcome-soon-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  opacity: 0.75;
}
.welcome-notify {
  margin-top: auto;
  padding-top: 20px;
  background: none;
  border: none;
  font-size: 13px;
  color: var(--dim);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  text-align: left;
}
.welcome-notify:hover:not(:disabled) { color: var(--navy); }
.welcome-notify:disabled { cursor: default; }
@media (max-width: 639px) {
  .welcome-cards { flex-direction: column; max-width: 400px; }
  .welcome-soon-grid { grid-template-columns: 1fr; max-width: 400px; }
}
`;

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

function FeatureList({ features, dark }: { features: Feature[]; dark: boolean }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {features.map((f) => (
        <li key={f.label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <CheckCircle2 size={16} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
          <span
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: f.comingSoon ? "var(--dim)" : dark ? "#FFFFFF" : "var(--ink)",
            }}
          >
            {f.label}
            {f.comingSoon && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  color: "var(--dim)",
                  background: "rgba(255,255,255,0.08)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                Soon
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Price({ dark, amount = 49 }: { dark: boolean; amount?: number }) {
  return (
    <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ fontSize: 40, fontWeight: 500, lineHeight: 1, color: dark ? "#FFFFFF" : "var(--navy)" }}>
        ${amount}
      </span>
      <span style={{ fontSize: 16, fontWeight: 300, color: dark ? "#8FA3B8" : "var(--dim)" }}>/month</span>
    </div>
  );
}

function CheckoutButton({
  label,
  variant,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  variant: "gold" | "outline";
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`welcome-cta welcome-cta--${variant}`}
        disabled={disabled}
        onClick={onClick}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" color={variant === "gold" ? "#FFFFFF" : undefined} />
            Redirecting to checkout...
          </>
        ) : (
          label
        )}
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 10 }}>
        <Lock size={11} color="var(--dim)" />
        <span style={{ fontSize: 11, color: "var(--dim)" }}>Secure payment via Stripe</span>
      </div>
    </>
  );
}

function ComingSoonCard({
  tier,
  notified,
  pending,
  onNotify,
}: {
  tier: ComingSoonTier;
  notified: boolean;
  pending: boolean;
  onNotify: () => void;
}) {
  return (
    <div className="welcome-soon-card">
      <span
        style={{
          alignSelf: "flex-start",
          background: "var(--cloud)",
          border: "1px solid var(--line)",
          borderRadius: 20,
          padding: "3px 10px",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--navy)",
          marginBottom: 12,
        }}
      >
        Coming soon
      </span>
      <h3 style={{ fontSize: 18, fontWeight: 500, color: "var(--navy)", margin: 0 }}>{tier.name}</h3>
      <Price dark={false} amount={tier.price} />

      <div style={{ borderTop: "1px solid var(--cloud)", margin: "20px 0" }} />
      <FeatureList features={tier.features} dark={false} />

      {notified ? (
        <p style={{ marginTop: "auto", paddingTop: 20, marginBottom: 0, fontSize: 13, color: "var(--teal)" }}>
          ✓ You&apos;re on the list
        </p>
      ) : (
        <button type="button" className="welcome-notify" disabled={pending} onClick={onNotify}>
          {pending ? "Adding you..." : "Notify me when available"}
        </button>
      )}
    </div>
  );
}

export default function WelcomeClient({
  spotsRemaining,
  totalSpots,
  userEmail,
}: {
  spotsRemaining: number;
  totalSpots: number;
  userEmail: string;
}) {
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);
  const [error, setError] = useState(false);
  const [notifiedTiers, setNotifiedTiers] = useState<Set<string>>(new Set());
  const [pendingTier, setPendingTier] = useState<ComingSoonTierKey | null>(null);
  const foundingAvailable = spotsRemaining > 0;

  async function notifyMe(feature: ComingSoonTierKey) {
    setPendingTier(feature);
    try {
      const res = await fetch("/api/notify-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, feature }),
      });
      if (res.ok) setNotifiedTiers((prev) => new Set(prev).add(feature));
    } catch {
      // leave the link in place so the user can retry
    } finally {
      setPendingTier(null);
    }
  }

  async function startCheckout(planKey: PlanKey) {
    setLoadingPlan(planKey);
    setError(false);
    try {
      // The checkout route sets its own success/cancel URLs; a cancelled
      // checkout lands on /dashboard/settings, which the proxy sends back here.
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey, mode: "subscription" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch {
      setLoadingPlan(null);
      setError(true);
    }
  }

  // Signs out the current (unsubscribed) user so a different account can sign
  // in — otherwise the proxy bounces a signed-in user from /auth straight back here.
  async function handleSignIn() {
    try {
      await createClient().auth.signOut();
    } catch {
      // best-effort — proceed with redirect even if sign-out fails
    }
    window.location.href = "/auth";
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--cloud)", padding: "32px 16px 48px" }}>
      <style>{CSS}</style>

      {/* Header */}
      <header style={{ textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <RisingColumnMark />
          <p style={{ fontSize: 20, fontWeight: 500, color: "var(--navy)", margin: 0 }}>
            Elidan <span style={{ fontWeight: 300, color: "var(--teal)" }}>AI</span>
          </p>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 500, color: "var(--navy)", margin: "16px 0 0" }}>
          Choose your plan
        </h1>
        <p style={{ fontSize: 14, color: "var(--dim)", margin: "8px 0 0" }}>
          Start seeing your business finances clearly. Cancel anytime.
        </p>
      </header>

      {/* Availability banner */}
      {foundingAvailable ? (
        <div
          style={{
            maxWidth: 480,
            margin: "24px auto 0",
            background: "#FBF5EC",
            border: "1px solid var(--gold)",
            borderRadius: "var(--radius-md)",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Star size={16} color="var(--gold)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "#7D4E00" }}>
            {spotsRemaining} of {totalSpots} Founding Member {spotsRemaining === 1 ? "spot" : "spots"} remaining —
            lock in Starter + Core features at $49/month, forever.
          </span>
        </div>
      ) : (
        <div
          style={{
            maxWidth: 400,
            margin: "24px auto 0",
            background: "var(--cloud)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-md)",
            padding: "12px 20px",
            fontSize: 13,
            color: "var(--dim)",
            textAlign: "center",
          }}
        >
          Founding Member spots are now full. Upgrade to Core anytime after subscribing to unlock AI
          features.
        </div>
      )}

      {/* Plan cards */}
      <div className={`welcome-cards${foundingAvailable ? "" : " welcome-cards--single"}`}>
        {foundingAvailable && (
          <div
            className="welcome-card"
            style={{ background: "var(--navy)", border: "1px solid var(--gold)", position: "relative" }}
          >
            <span
              style={{
                position: "absolute",
                top: -12,
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--gold)",
                color: "var(--navy)",
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                borderRadius: 20,
                padding: "4px 16px",
                whiteSpace: "nowrap",
              }}
            >
              Recommended
            </span>

            <Star size={24} color="var(--gold)" style={{ marginBottom: 12 }} />
            <h2 style={{ fontSize: 18, fontWeight: 500, color: "#FFFFFF", margin: 0 }}>Founding Member</h2>
            <span
              style={{
                display: "inline-block",
                marginTop: 6,
                background: "rgba(212,175,127,0.15)",
                border: "1px solid rgba(212,175,127,0.3)",
                borderRadius: 20,
                padding: "3px 10px",
                fontSize: 11,
                color: "var(--gold)",
              }}
            >
              {spotsRemaining} of {totalSpots} spots left
            </span>

            <Price dark />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <Lock size={12} color="var(--gold)" />
              <span style={{ fontSize: 12, color: "var(--gold)" }}>Locked forever — never increases</span>
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "20px 0" }} />
            <FeatureList features={FOUNDING_FEATURES} dark />

            <CheckoutButton
              label="Become a Founding Member →"
              variant="gold"
              loading={loadingPlan === "founding_member"}
              disabled={loadingPlan !== null}
              onClick={() => startCheckout("founding_member")}
            />
          </div>
        )}

        <div
          className="welcome-card"
          style={{ background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "var(--shadow-sm)" }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 500, color: "var(--navy)", margin: 0 }}>Starter</h2>
          <p style={{ fontSize: 13, color: "var(--dim)", margin: "4px 0 0" }}>Core dashboard and alerts</p>

          <Price dark={false} />

          <div style={{ borderTop: "1px solid var(--cloud)", margin: "20px 0" }} />
          <FeatureList features={STARTER_FEATURES} dark={false} />
          <p style={{ fontSize: 12, color: "var(--dim)", fontStyle: "italic", margin: "12px 0 0" }}>
            Upgrade to Core anytime to unlock AI features and accounting sync.
          </p>

          <CheckoutButton
            label="Get started with Starter →"
            variant="outline"
            loading={loadingPlan === "starter"}
            disabled={loadingPlan !== null}
            onClick={() => startCheckout("starter")}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            maxWidth: 480,
            margin: "24px auto 0",
            border: "1px solid var(--danger, #E84545)",
            background: "rgba(232,69,69,0.06)",
            borderRadius: "var(--radius-md)",
            padding: "12px 20px",
            fontSize: 13,
            color: "var(--ink)",
            textAlign: "center",
          }}
        >
          Something went wrong. Please try again or contact hello@elidan.ai
        </div>
      )}

      {/* Coming soon tiers */}
      <p
        style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--dim)",
          textAlign: "center",
          margin: "40px 0 20px",
        }}
      >
        Coming soon
      </p>
      <div className="welcome-soon-grid">
        {COMING_SOON_TIERS.map((tier) => (
          <ComingSoonCard
            key={tier.key}
            tier={tier}
            notified={notifiedTiers.has(tier.key)}
            pending={pendingTier === tier.key}
            onNotify={() => notifyMe(tier.key)}
          />
        ))}
      </div>

      {/* Footer */}
      <footer style={{ textAlign: "center" }}>
        <button
          type="button"
          onClick={handleSignIn}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            fontSize: 13,
            color: "var(--dim)",
            marginTop: 32,
          }}
        >
          Already have an account?{" "}
          <span className="welcome-link">Sign in →</span>
        </button>
        <p style={{ fontSize: 11, color: "var(--dim)", margin: "12px 0 0" }}>
          By subscribing you agree to our{" "}
          <a href="https://elidan.ai/terms" className="welcome-link">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="https://elidan.ai/privacy" className="welcome-link">
            Privacy Policy
          </a>
        </p>
      </footer>
    </div>
  );
}
