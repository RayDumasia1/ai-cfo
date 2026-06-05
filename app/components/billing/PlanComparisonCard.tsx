"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { Plan, FeatureTier } from "@/lib/featureGates";
import { GROWTH_AVAILABLE, ADVISORY_AVAILABLE } from "@/lib/launchConfig";

interface PlanComparisonCardProps {
  currentPlan: Plan;
  currentTier: FeatureTier;
}

const PLAN_ROWS: { key: Plan; tier: FeatureTier; name: string; price: string; features: string }[] = [
  { key: "starter",  tier: "starter",  name: "Starter",  price: "$49 / mo",  features: "Dashboard · Excel import · Alerts" },
  { key: "core",     tier: "core",     name: "Core",     price: "$99 / mo",  features: "Ask CFO · AI insights · QB & Xero sync" },
  { key: "growth",   tier: "growth",   name: "Growth",   price: "$199 / mo", features: "Unlimited AI · Forecasting · Scenarios" },
  { key: "advisory", tier: "advisory", name: "Advisory", price: "$599 / mo", features: "Monthly CFO call · Team seats · Reports" },
];

const TIER_RANK: Record<FeatureTier, number> = {
  suspended: -1,
  starter: 0,
  core: 1,
  growth: 2,
  advisory: 3,
};

function isTierAvailable(tier: FeatureTier): boolean {
  if (tier === "growth") return GROWTH_AVAILABLE;
  if (tier === "advisory") return ADVISORY_AVAILABLE;
  return true;
}

function UpgradeButton({ planKey }: { planKey: Plan }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey, mode: "subscription" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleUpgrade}
        disabled={loading}
        style={{
          padding: "6px 14px",
          fontSize: 13,
          fontWeight: 500,
          color: "#FFFFFF",
          backgroundColor: loading ? "#6B7A8D" : "#2CA6A4",
          border: "none",
          borderRadius: 6,
          cursor: loading ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
        }}
      >
        {loading && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
        {loading ? "Redirecting..." : "Upgrade →"}
      </button>
      {error && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DowngradeButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePortal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not open portal");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handlePortal}
        disabled={loading}
        style={{
          padding: "6px 14px",
          fontSize: 13,
          fontWeight: 400,
          color: "#6B7A8D",
          backgroundColor: "transparent",
          border: "1px solid #D8E2EC",
          borderRadius: 6,
          cursor: loading ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "Opening..." : "Downgrade"}
      </button>
      {error && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>}
    </div>
  );
}

function DisabledDowngradeButton() {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        disabled
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "6px 14px",
          fontSize: 13,
          fontWeight: 400,
          color: "#6B7A8D",
          backgroundColor: "transparent",
          border: "1px solid #D8E2EC",
          borderRadius: 6,
          cursor: "not-allowed",
          whiteSpace: "nowrap",
          opacity: 0.4,
        }}
      >
        Downgrade
      </button>
      {hovered && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            backgroundColor: "#0A1A2F",
            color: "#FFFFFF",
            fontSize: 12,
            borderRadius: 6,
            padding: "6px 10px",
            whiteSpace: "nowrap",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          To change your plan, contact us at hello@elidan.ai
        </div>
      )}
    </div>
  );
}

const comingSoonBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  backgroundColor: "#F4F7FA",
  color: "#6B7A8D",
  border: "1px solid #D8E2EC",
  whiteSpace: "nowrap",
};

const currentBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  backgroundColor: "rgba(44,166,164,0.10)",
  color: "#2CA6A4",
  border: "1px solid rgba(44,166,164,0.30)",
  whiteSpace: "nowrap",
};

const STORAGE_KEY = "elidan_plans_collapsed";

export default function PlanComparisonCard({ currentPlan, currentTier }: PlanComparisonCardProps) {
  const [collapsed, setCollapsed] = useState(true);
  const currentRank = TIER_RANK[currentTier];
  const isFoundingMember = currentPlan === "founding_member";

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  return (
    <section
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #D8E2EC",
        borderRadius: 16,
        boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
        padding: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, color: "#0A1A2F", margin: 0 }}>
          Available Plans
        </h2>
        <button
          onClick={toggle}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "#2CA6A4",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          Compare plans {collapsed ? "▾" : "▴"}
        </button>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 20 }}>
          {PLAN_ROWS.map((plan, i) => {
            const isCurrent =
              currentPlan === plan.key ||
              (isFoundingMember && plan.key === "core");
            const planRank = TIER_RANK[plan.tier];
            const isHigher = planRank > currentRank;
            const isLower = planRank < currentRank;
            const isComingSoon = isHigher && !isTierAvailable(plan.tier);
            const isLast = i === PLAN_ROWS.length - 1;

            return (
              <div
                key={plan.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "16px 0",
                  borderBottom: isLast ? "none" : "1px solid #F4F7FA",
                }}
              >
                {/* Left — name + price */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 16, fontWeight: 500, color: "#0A1A2F", margin: "0 0 2px" }}>
                    {plan.name}
                  </p>
                  <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0 }}>
                    {plan.price}
                  </p>
                </div>

                {/* Middle — 3 key features */}
                <div style={{ flex: 2, padding: "0 24px", minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0 }}>
                    {plan.features}
                  </p>
                </div>

                {/* Right — status/action */}
                <div style={{ flexShrink: 0 }}>
                  {isCurrent ? (
                    <span style={currentBadge}>Your features</span>
                  ) : isHigher ? (
                    isComingSoon ? (
                      <span style={comingSoonBadge}>Coming soon</span>
                    ) : (
                      <UpgradeButton planKey={plan.key} />
                    )
                  ) : isLower ? (
                    isFoundingMember ? <DisabledDowngradeButton /> : <DowngradeButton />
                  ) : null}
                </div>
              </div>
            );
          })}

          {isFoundingMember && (
            <p
              style={{
                fontSize: 12,
                color: "#6B7A8D",
                fontStyle: "italic",
                marginTop: 12,
                marginBottom: 0,
              }}
            >
              You&apos;re billed as Founding Member at $49/month — Core features included permanently.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
