"use client";

import { useEffect, useState } from "react";
import type { FeatureTier } from "@/lib/featureGates";

interface UsageItem {
  metric: string;
  count: number;
  limit: number | null;
}

interface UsageCardProps {
  periodStart: string | null;
  periodEnd: string | null;
  tier: FeatureTier;
}

const METRIC_LABELS: Record<string, string> = {
  ask_cfo_questions: "Ask CFO questions",
  ai_insight_runs: "AI insight runs",
  actions_active: "Active actions",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function UsageBar({ count, limit }: { count: number; limit: number | null }) {
  if (limit === null) {
    return (
      <span style={{ fontSize: 12, color: "#2CA6A4", fontWeight: 500 }}>
        Unlimited
      </span>
    );
  }
  const pct = limit === 0 ? 0 : Math.min((count / limit) * 100, 100);
  const isWarning = pct > 80;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          backgroundColor: "#D8E2EC",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: isWarning ? "#D97706" : "#2CA6A4",
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "#6B7A8D", minWidth: 60, textAlign: "right" }}>
        {count} / {limit}
      </span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          height: 12,
          width: 140,
          backgroundColor: "#D8E2EC",
          borderRadius: 4,
          marginBottom: 8,
        }}
      />
      <div
        style={{
          height: 6,
          backgroundColor: "#D8E2EC",
          borderRadius: 3,
        }}
      />
    </div>
  );
}

export default function UsageCard({ periodStart, periodEnd, tier }: UsageCardProps) {
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((data) => {
        setUsage(data.usage ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const periodLabel =
    periodStart && periodEnd
      ? `${formatDate(periodStart)} – ${formatDate(periodEnd)}`
      : tier === "core" || tier === "growth"
      ? "Current billing period"
      : null;

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
          margin: "0 0 4px",
        }}
      >
        Usage this period
      </h2>
      {periodLabel && (
        <p style={{ fontSize: 12, color: "#6B7A8D", margin: "0 0 20px" }}>
          {periodLabel}
        </p>
      )}

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : (
        <div>
          {usage.map((item) => (
            <div key={item.metric} style={{ marginBottom: 16 }}>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#344150",
                  margin: "0 0 6px",
                }}
              >
                {METRIC_LABELS[item.metric] ?? item.metric}
              </p>
              <UsageBar count={item.count} limit={item.limit} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
