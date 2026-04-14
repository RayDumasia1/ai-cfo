"use client";

import { useState } from "react";
import type { Alert, SnoozeType } from "@/lib/types";
import DismissibleAlert from "./DismissibleAlert";

interface AlertsListProps {
  initialAlerts: Alert[];
  snoozeDuration: SnoozeType;
  emptyMessage?: string;
}

const SEVERITY_ORDER: Record<Alert["severity"], number> = {
  danger: 0,
  warning: 1,
  success: 2,
};

function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

export default function AlertsList({
  initialAlerts,
  snoozeDuration,
  emptyMessage,
}: AlertsListProps) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);

  function onDismissed(alertCode: string) {
    setAlerts((prev) => prev.filter((a) => a.code !== alertCode));
  }

  function onRestored(alert: Alert) {
    setAlerts((prev) => sortAlerts([...prev, alert]));
  }

  if (alerts.length === 0 && emptyMessage) {
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
          ✓ {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {alerts.map((alert) => (
          <DismissibleAlert
            key={alert.code}
            alert={alert}
            snoozeType={snoozeDuration}
            onDismissed={onDismissed}
            onRestored={onRestored}
          />
        ))}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
