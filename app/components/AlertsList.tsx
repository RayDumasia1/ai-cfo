"use client";

import { useEffect, useState } from "react";
import type { ActionInsert, Alert, SnoozeType } from "@/lib/types";
import DismissibleAlert from "./DismissibleAlert";

interface AlertsListProps {
  initialAlerts: Alert[];
  snoozeDuration: SnoozeType;
  emptyMessage?: string;
  onCreateAction?: (prefill: Partial<ActionInsert>) => void;
}

export default function AlertsList({
  initialAlerts,
  snoozeDuration,
  emptyMessage,
  onCreateAction,
}: AlertsListProps) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);

  // Sync state when the server re-fetches after import or clear
  useEffect(() => {
    setAlerts(initialAlerts);
  }, [initialAlerts]);

  function onDismissed(alertCode: string) {
    setAlerts((prev) => prev.filter((a) => a.code !== alertCode));
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
            onCreateAction={onCreateAction}
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
