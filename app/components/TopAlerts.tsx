"use client";

import type { Alert, DismissedAlert, SnoozeType } from "@/lib/types";
import AlertsList from "./AlertsList";

interface TopAlertsProps {
  alerts: Alert[];
  dismissedAlerts: DismissedAlert[];
  dataVersion: string | null;
  snoozeDuration: SnoozeType;
}

/**
 * Renders danger and warning alerts above the stat cards.
 * Returns null when no danger/warning alerts are active — no empty state here.
 */
export default function TopAlerts({
  alerts,
  snoozeDuration,
}: TopAlertsProps) {
  const urgent = alerts.filter(
    (a) => a.severity === "danger" || a.severity === "warning"
  );

  if (urgent.length === 0) return null;

  return (
    <div className="mb-6">
      <AlertsList
        initialAlerts={urgent}
        snoozeDuration={snoozeDuration}
      />
    </div>
  );
}
