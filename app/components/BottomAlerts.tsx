"use client";

import type { Alert, DismissedAlert, SnoozeType } from "@/lib/types";
import AlertsList from "./AlertsList";

interface BottomAlertsProps {
  /** The full visible alerts array — used both to filter success alerts and to
   *  determine whether to show the "everything healthy" message. */
  alerts: Alert[];
  dismissedAlerts: DismissedAlert[];
  dataVersion: string | null;
  snoozeDuration: SnoozeType;
}

/**
 * Renders success alerts below the chart.
 * Shows "Everything looks healthy" only when the total alerts array is empty
 * (no danger, warning, or success firing at all).
 * Returns null when there are non-success alerts but no success alerts
 * (avoids an orphaned panel with nothing useful to say).
 */
export default function BottomAlerts({
  alerts,
  snoozeDuration,
}: BottomAlertsProps) {
  const successAlerts = alerts.filter((a) => a.severity === "success");
  const totalAlerts = alerts.length;

  // Zero alerts total → healthy message (via emptyMessage on AlertsList)
  if (totalAlerts === 0) {
    return (
      <AlertsList
        initialAlerts={[]}
        snoozeDuration={snoozeDuration}
        emptyMessage="Everything looks healthy — no alerts at this time."
      />
    );
  }

  // No success alerts (but there are danger/warning above) → render nothing here
  if (successAlerts.length === 0) return null;

  return (
    <AlertsList
      initialAlerts={successAlerts}
      snoozeDuration={snoozeDuration}
    />
  );
}
