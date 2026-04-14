"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { Alert, SnoozeType } from "@/lib/types";

interface DismissibleAlertProps {
  alert: Alert;
  snoozeType: SnoozeType;
  onDismissed: (alertCode: string) => void;
  onRestored: (alert: Alert) => void;
}

const severityStyles: Record<
  Alert["severity"],
  { border: string; icon: string; titleColor: string; bg: string }
> = {
  danger:  { border: "#ef4444", icon: "✕", titleColor: "#ef4444", bg: "#fef2f2" },
  warning: { border: "#f59e0b", icon: "⚠", titleColor: "#b45309", bg: "#fffbeb" },
  success: { border: "#22c55e", icon: "✓", titleColor: "#15803d", bg: "#f0fdf4" },
};

const TOOLTIP_TEXT: Record<SnoozeType, string> = {
  "24h":         "Dismiss for 24 hours",
  "7d":          "Dismiss for 7 days",
  "data_reload": "Dismiss until next import",
};

/** Inline toast — shown bottom-right on dismiss failure. */
function Toast({
  message,
  visible,
}: {
  message: string;
  visible: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        backgroundColor: "#0A1A2F",
        color: "#FFFFFF",
        fontSize: 13,
        fontWeight: 500,
        padding: "10px 16px",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(10,26,47,0.25)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
        pointerEvents: "none",
      }}
    >
      {message}
    </div>
  );
}

export default function DismissibleAlert({
  alert,
  snoozeType,
  onDismissed,
  onRestored,
}: DismissibleAlertProps) {
  const s = severityStyles[alert.severity];
  const canDismiss = alert.severity !== "danger";
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleDismiss() {
    // Optimistic remove
    onDismissed(alert.code);

    try {
      const res = await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_code: alert.code,
          snooze_type: snoozeType,
        }),
      });

      if (!res.ok) {
        throw new Error("dismiss failed");
      }
    } catch {
      // Restore on failure
      onRestored(alert);

      // Show toast for 3 seconds
      setToastVisible(true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastVisible(false), 3000);
    }
  }

  return (
    <>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          borderRadius: "var(--radius-md)",
          border: `1px solid ${s.border}`,
          borderLeft: `4px solid ${s.border}`,
          backgroundColor: s.bg,
          padding: "0.75rem 1rem",
          animation: "fadeIn 0.2s ease-in",
          paddingRight: canDismiss ? "2.5rem" : "1rem",
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
          <p className="text-sm font-medium" style={{ color: s.titleColor }}>
            {alert.title}
          </p>
          <p
            className="mt-0.5 text-xs font-light"
            style={{ color: "var(--ink)" }}
          >
            {alert.message}
          </p>
        </div>

        {canDismiss && (
          <button
            onClick={handleDismiss}
            title={TOOLTIP_TEXT[snoozeType]}
            aria-label={TOOLTIP_TEXT[snoozeType]}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "transparent",
              color: "#6B7A8D",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "rgba(0,0,0,0.06)";
              (e.currentTarget as HTMLButtonElement).style.color = "#344150";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#6B7A8D";
            }}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <Toast message="Could not dismiss — please try again" visible={toastVisible} />
    </>
  );
}
