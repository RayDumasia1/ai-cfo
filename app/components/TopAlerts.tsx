"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Alert, DismissedAlert, SnoozeType } from "@/lib/types";
import AlertsList from "./AlertsList";

const STORAGE_KEY = "elidan_alerts_collapsed";

interface TopAlertsProps {
  alerts: Alert[];
  dismissedAlerts: DismissedAlert[];
  dataVersion: string | null;
  snoozeDuration: SnoozeType;
}

export default function TopAlerts({
  alerts,
  dataVersion,
  snoozeDuration,
}: TopAlertsProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prevDataVersion = useRef(dataVersion);

  // Read localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") {
        setCollapsed(true);
      }
    } catch {}
  }, []);

  // Reset to expanded when a new import arrives (dataVersion changes)
  useEffect(() => {
    if (dataVersion !== null && dataVersion !== prevDataVersion.current) {
      setCollapsed(false);
      try { localStorage.setItem(STORAGE_KEY, "false"); } catch {}
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
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
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
          onClick={toggle}
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
        style={{
          overflow: "hidden",
          maxHeight: collapsed ? "0" : "1000px",
          transition: "max-height 250ms ease-in-out",
        }}
      >
        <AlertsList initialAlerts={urgent} snoozeDuration={snoozeDuration} />
      </div>
    </div>
  );
}
