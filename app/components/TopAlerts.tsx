"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActionInsert, Alert, DismissedAlert, SnoozeType } from "@/lib/types";
import AlertsList from "./AlertsList";
import { readBrowserBoolean, writeBrowserValue } from "@/lib/browserStorage";

const STORAGE_KEY = "elidan_alerts_collapsed";

// localStorage has no same-tab change events; toggles go through component state
const subscribeNoop = () => () => {};

function readStoredCollapsed(): boolean {
  return readBrowserBoolean("localStorage", STORAGE_KEY, false);
}

interface TopAlertsProps {
  alerts: Alert[];
  dismissedAlerts: DismissedAlert[];
  dataVersion: string | null;
  snoozeDuration: SnoozeType;
  /** Danger/warning alert cards show "Create action" when provided. */
  onCreateAction?: (prefill: Partial<ActionInsert>) => void;
}

export default function TopAlerts({
  alerts,
  dataVersion,
  snoozeDuration,
  onCreateAction,
}: TopAlertsProps) {
  // Read localStorage on the client only; the server snapshot (false) avoids SSR mismatch
  const storedCollapsed = useSyncExternalStore(subscribeNoop, readStoredCollapsed, () => false);
  // null until the user toggles (or an import resets it) — falls back to the stored value
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const collapsed = collapsedOverride ?? storedCollapsed;

  // Reset to expanded when a new import arrives (dataVersion changes)
  const [seenDataVersion, setSeenDataVersion] = useState(dataVersion);
  if (dataVersion !== null && dataVersion !== seenDataVersion) {
    setSeenDataVersion(dataVersion);
    setCollapsedOverride(false);
  }

  // Persist the reset — side effect only, no state updates
  const prevDataVersion = useRef(dataVersion);
  useEffect(() => {
    if (dataVersion !== null && dataVersion !== prevDataVersion.current) {
      writeBrowserValue("localStorage", STORAGE_KEY, "false");
      prevDataVersion.current = dataVersion;
    }
  }, [dataVersion]);

  const urgent = alerts.filter(
    (a) => a.severity === "danger" || a.severity === "warning"
  );

  if (urgent.length === 0) return null;

  const hasDanger = urgent.some((a) => a.severity === "danger");
  const color      = hasDanger ? "rgb(232,69,69)"         : "#F59E0B";
  const bg         = hasDanger ? "rgba(232,69,69,0.06)"   : "rgba(245,158,11,0.06)";
  const badgeBg    = hasDanger ? "rgba(232,69,69,0.12)"   : "rgba(245,158,11,0.12)";
  const badgeBorder= hasDanger ? "rgba(232,69,69,0.25)"   : "rgba(245,158,11,0.25)";

  function toggle() {
    const next = !collapsed;
    setCollapsedOverride(next);
    writeBrowserValue("localStorage", STORAGE_KEY, String(next));
  }

  return (
    <div className="mb-6">
      {/* Header bar — always visible when alerts exist */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          backgroundColor: bg,
          borderRadius: "var(--radius-md)",
          borderLeft: `3px solid ${color}`,
          marginBottom: collapsed ? 0 : "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <AlertTriangle size={14} style={{ color }} />
          <span style={{ fontSize: "13px", fontWeight: 500, color }}>
            Alerts
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color,
              backgroundColor: badgeBg,
              padding: "1px 7px",
              borderRadius: "999px",
              border: `1px solid ${badgeBorder}`,
            }}
          >
            {urgent.length}
          </span>
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="dashboard-alert-list"
          className="transition-opacity hover:opacity-75"
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--teal)",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          {collapsed ? "Expand ▾" : "Collapse ▴"}
        </button>
      </div>

      {/* Collapsible alerts list */}
      <div
        id="dashboard-alert-list"
        style={{
          overflow: "hidden",
          maxHeight: collapsed ? "0" : "1000px",
          transition: "max-height 250ms ease-in-out",
        }}
      >
        <AlertsList
          initialAlerts={urgent}
          snoozeDuration={snoozeDuration}
          onCreateAction={onCreateAction}
        />
      </div>
    </div>
  );
}
