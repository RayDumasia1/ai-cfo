"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { Plan, FeatureTier } from "@/lib/featureGates";

interface PlanComparisonCardProps {
  currentPlan: Plan;
  currentTier: FeatureTier;
}

interface PlanDef {
  key: Plan;
  tier: FeatureTier;
  name: string;
  price: string;
  features: string[];
}

const PLANS: PlanDef[] = [
  {
    key: "starter",
    tier: "starter",
    name: "Starter",
    price: "$49 / mo",
    features: [
      "Financial dashboard",
      "Data import (Excel/CSV)",
      "Up to 10 active actions",
    ],
  },
  {
    key: "core",
    tier: "core",
    name: "Core",
    price: "$99 / mo",
    features: [
      "Everything in Starter",
      "Ask your CFO (20 questions/mo)",
      "AI insights (3 runs/mo)",
      "QuickBooks & Xero sync",
      "Weekly CFO summary",
      "Up to 50 active actions",
    ],
  },
  {
    key: "growth",
    tier: "growth",
    name: "Growth",
    price: "$199 / mo",
    features: [
      "Everything in Core",
      "Unlimited Ask CFO",
      "Unlimited AI insights",
      "12-month cash flow forecast",
      "Scenario comparison",
      "Unlimited active actions",
    ],
  },
  {
    key: "advisory",
    tier: "advisory",
    name: "Advisory",
    price: "$599 / mo",
    features: [
      "Everything in Growth",
      "Monthly CFO call",
      "Team seats (3 users)",
      "Custom reports",
    ],
  },
];

const TIER_RANK: Record<FeatureTier, number> = {
  suspended: -1,
  starter: 0,
  core: 1,
  growth: 2,
  advisory: 3,
};

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
          width: "100%",
          padding: "8px 0",
          fontSize: 13,
          fontWeight: 500,
          color: "#FFFFFF",
          background: loading ? "#6B7A8D" : "#2CA6A4",
          border: "none",
          borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {loading && (
          <Loader2
            size={13}
            style={{ animation: "spin 1s linear infinite" }}
          />
        )}
        {loading ? "Redirecting..." : "Upgrade →"}
      </button>
      {error && (
        <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>
      )}
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
          width: "100%",
          padding: "8px 0",
          fontSize: 13,
          fontWeight: 400,
          color: "#6B7A8D",
          background: "transparent",
          border: "1px solid #D8E2EC",
          borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Opening..." : "Downgrade"}
      </button>
      {error && (
        <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{error}</p>
      )}
    </div>
  );
}

export default function PlanComparisonCard({
  currentPlan,
  currentTier,
}: PlanComparisonCardProps) {
  const currentRank = TIER_RANK[currentTier];

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
      <h2
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "#0A1A2F",
          margin: "0 0 20px",
        }}
      >
        Plans
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent =
            currentPlan === plan.key ||
            (currentPlan === "founding_member" && plan.key === "core");
          const planRank = TIER_RANK[plan.tier];
          const isHigher = planRank > currentRank;
          const isLower = planRank < currentRank;

          return (
            <div
              key={plan.key}
              style={{
                borderRadius: 10,
                border: isCurrent
                  ? "1px solid rgba(44,166,164,0.40)"
                  : "1px solid #D8E2EC",
                backgroundColor: isCurrent
                  ? "rgba(44,166,164,0.04)"
                  : "#FAFBFC",
                padding: "16px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#0A1A2F",
                    margin: "0 0 2px",
                  }}
                >
                  {plan.name}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: "#6B7A8D",
                    margin: 0,
                  }}
                >
                  {plan.price}
                </p>
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
                {plan.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 6,
                      fontSize: 11,
                      color: "#344150",
                      marginBottom: 5,
                    }}
                  >
                    <Check size={11} color="#2CA6A4" style={{ marginTop: 2, flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>

              <div>
                {isCurrent ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "8px 0",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#2CA6A4",
                      background: "rgba(44,166,164,0.08)",
                      borderRadius: 8,
                    }}
                  >
                    Current plan
                  </div>
                ) : isHigher ? (
                  <UpgradeButton planKey={plan.key} />
                ) : isLower ? (
                  <DowngradeButton />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
