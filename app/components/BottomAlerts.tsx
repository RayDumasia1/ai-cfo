"use client";

import type { Alert } from "@/lib/types";

interface BottomAlertsProps {
  /** The full alerts array — used both to filter success alerts and to determine
   *  whether to show the "everything healthy" message. */
  alerts: Alert[];
}

const successStyle = {
  border: "#22c55e",
  icon: "✓",
  titleColor: "#15803d",
  bg: "#f0fdf4",
} as const;

/**
 * Renders success alerts below the chart.
 * Shows "Everything looks healthy ✓" only when the total alerts array is empty
 * (no danger, warning, or success firing at all).
 * Returns null when there are non-success alerts but no success alerts
 * (avoids an orphaned panel with nothing useful to say).
 */
export default function BottomAlerts({ alerts }: BottomAlertsProps) {
  const successAlerts = alerts.filter((a) => a.severity === "success");
  const totalAlerts = alerts.length;

  // Zero alerts total → healthy message
  if (totalAlerts === 0) {
    return (
      <div
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
          padding: "1rem 1.25rem",
          backgroundColor: "var(--surface)",
        }}
      >
        <p className="text-sm font-light" style={{ color: "var(--dim)" }}>
          ✓ Everything looks healthy — no alerts at this time.
        </p>
      </div>
    );
  }

  // No success alerts (but there are danger/warning above) → render nothing here
  if (successAlerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {successAlerts.map((alert) => (
        <div
          key={alert.code}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${successStyle.border}`,
            borderLeft: `4px solid ${successStyle.border}`,
            backgroundColor: successStyle.bg,
            padding: "0.75rem 1rem",
            animation: "fadeIn 0.2s ease-in",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: successStyle.titleColor,
              flexShrink: 0,
              paddingTop: 1,
            }}
          >
            {successStyle.icon}
          </span>
          <div>
            <p
              className="text-sm font-medium"
              style={{ color: successStyle.titleColor }}
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
      ))}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
