"use client";

import type { ActionInsert, Alert, DismissedAlert, SnoozeType } from "@/lib/types";
import AlertsList from "./AlertsList";
import type {FinancialDataFreshness} from "@/lib/calculations";

interface BottomAlertsProps {
  /** The full visible alerts array — used both to filter success alerts and to
   *  determine whether to show freshness-aware empty guidance. */
  alerts: Alert[];
  dismissedAlerts: DismissedAlert[];
  dataVersion: string | null;
  snoozeDuration: SnoozeType;
  /** Danger/warning alert cards show "Create action" when provided. */
  onCreateAction?: (prefill: Partial<ActionInsert>) => void;
  dataFreshness: FinancialDataFreshness;
}

/**
 * Renders success alerts below the chart.
 * Shows a data-freshness-aware message when the total alerts array is empty.
 * Returns null when there are non-success alerts but no success alerts
 * (avoids an orphaned panel with nothing useful to say).
 */
export default function BottomAlerts({
  alerts,
  snoozeDuration,
  onCreateAction,
  dataFreshness,
}: BottomAlertsProps) {
  const successAlerts = alerts.filter((a) => a.severity === "success");
  const totalAlerts = alerts.length;

  const emptyMessage=dataFreshness==="historical"
    ? "Update your financial data to receive a current cash-health assessment."
    : dataFreshness==="stale"
      ? "No warnings detected, but your financial data may be out of date."
      : dataFreshness==="unknown"
        ? "Add financial data to receive a cash-health assessment."
        : "No financial warnings detected from the information provided.";

  if (totalAlerts === 0) {
    return (
      <AlertsList
        initialAlerts={[]}
        snoozeDuration={snoozeDuration}
        onCreateAction={onCreateAction}
        emptyMessage={emptyMessage}
      />
    );
  }

  // No success alerts (but there are danger/warning above) → render nothing here
  if (successAlerts.length === 0) return null;

  return (
    <AlertsList
      initialAlerts={successAlerts}
      snoozeDuration={snoozeDuration}
        onCreateAction={onCreateAction}
    />
  );
}
