"use client";

import { alertEngine } from "@/lib/calculations";
import type { BusinessProfile, FinancialMonth } from "@/lib/types";
import type { Alert } from "@/lib/types";

interface AlertsPanelProps {
  months: FinancialMonth[];
  profile: BusinessProfile;
}

const severityStyles: Record<
  Alert["severity"],
  { border: string; icon: string; titleColor: string }
> = {
  danger: {
    border: "#ef4444",
    icon: "✕",
    titleColor: "#ef4444",
  },
  warning: {
    border: "#f59e0b",
    icon: "⚠",
    titleColor: "#f59e0b",
  },
  success: {
    border: "#22c55e",
    icon: "✓",
    titleColor: "#22c55e",
  },
};

export default function AlertsPanel({ months, profile }: AlertsPanelProps) {
  const alerts = alertEngine(months, profile);

  if (alerts.length === 0) {
    return (
      <div
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
          padding: "1.25rem 1.5rem",
          backgroundColor: "var(--surface)",
        }}
      >
        <p
          className="text-[11px] font-medium uppercase tracking-[0.08em] mb-3"
          style={{ color: "var(--dim)" }}
        >
          Alerts
        </p>
        <p className="text-sm font-light" style={{ color: "var(--dim)" }}>
          ✓ No alerts — all metrics are within healthy ranges.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
        padding: "1.25rem 1.5rem",
        backgroundColor: "var(--surface)",
      }}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-[0.08em] mb-3"
        style={{ color: "var(--dim)" }}
      >
        Alerts
      </p>
      <div className="flex flex-col gap-3">
        {alerts.map((alert) => {
          const s = severityStyles[alert.severity];
          return (
            <div
              key={alert.code}
              style={{
                borderLeft: `3px solid ${s.border}`,
                paddingLeft: "0.75rem",
                animation: "fadeIn 0.2s ease-in",
              }}
            >
              <p
                className="text-sm font-medium"
                style={{ color: s.titleColor }}
              >
                {s.icon} {alert.title}
              </p>
              <p
                className="mt-0.5 text-xs font-light"
                style={{ color: "var(--ink)" }}
              >
                {alert.message}
              </p>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
