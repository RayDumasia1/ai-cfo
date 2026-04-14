"use client";

import type { Alert } from "@/lib/types";

interface TopAlertsProps {
  alerts: Alert[];
}

const severityStyles: Record<
  Alert["severity"],
  { border: string; icon: string; titleColor: string; bg: string }
> = {
  danger: { border: "#ef4444", icon: "✕", titleColor: "#ef4444", bg: "#fef2f2" },
  warning: { border: "#f59e0b", icon: "⚠", titleColor: "#b45309", bg: "#fffbeb" },
  success: { border: "#22c55e", icon: "✓", titleColor: "#15803d", bg: "#f0fdf4" },
};

/**
 * Renders danger and warning alerts above the stat cards.
 * Returns null when no danger/warning alerts are active — no empty state here.
 */
export default function TopAlerts({ alerts }: TopAlertsProps) {
  const urgent = alerts.filter(
    (a) => a.severity === "danger" || a.severity === "warning"
  );

  if (urgent.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-6">
      {urgent.map((alert) => {
        const s = severityStyles[alert.severity];
        return (
          <div
            key={alert.code}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.75rem",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${s.border}`,
              borderLeft: `4px solid ${s.border}`,
              backgroundColor: s.bg,
              padding: "0.75rem 1rem",
              animation: "fadeIn 0.2s ease-in",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: s.titleColor,
                flexShrink: 0,
                paddingTop: 1,
              }}
            >
              {s.icon}
            </span>
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: s.titleColor }}
              >
                {alert.title}
              </p>
              <p
                className="mt-0.5 text-xs font-light"
                style={{ color: "var(--ink)" }}
              >
                {alert.message}
              </p>
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
