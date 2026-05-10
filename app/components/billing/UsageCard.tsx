"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
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

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 minute ago";
  return `${diffMin} minutes ago`;
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
      <div style={{ height: 6, backgroundColor: "#D8E2EC", borderRadius: 3 }} />
    </div>
  );
}

export default function UsageCard({ periodStart, periodEnd, tier }: UsageCardProps) {
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  function fetchUsage(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    fetch("/api/usage")
      .then((r) => r.json())
      .then((data) => {
        setUsage(data.usage ?? []);
        setLastUpdated(new Date());
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    fetchUsage();
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
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#0A1A2F", margin: 0 }}>
          Usage this period
        </h2>
        <button
          onClick={() => fetchUsage(true)}
          disabled={refreshing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: "#2CA6A4",
            background: "transparent",
            border: "none",
            cursor: refreshing ? "default" : "pointer",
            padding: 0,
          }}
        >
          {refreshing ? (
            <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <RefreshCw size={12} />
          )}
          Refresh
        </button>
      </div>

      {periodLabel && (
        <p style={{ fontSize: 12, color: "#6B7A8D", margin: "0 0 4px" }}>
          {periodLabel}
        </p>
      )}
      {lastUpdated && (
        <p style={{ fontSize: 11, color: "#6B7A8D", fontStyle: "italic", margin: "0 0 16px" }}>
          Updated {formatRelativeTime(lastUpdated)}
        </p>
      )}

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : (
        <div style={{ marginTop: lastUpdated ? 0 : 16 }}>
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
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}
