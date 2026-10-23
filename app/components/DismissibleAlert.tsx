"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { ActionInsert, Alert, SnoozeType } from "@/lib/types";
import { alertToActionPrefill } from "@/lib/actions";
import { isProtectedAlertCode } from "@/lib/alertPolicy";
import { DATA_RELOAD_DISMISS_ERROR, DISMISS_ALERT_ERROR, requestAlertDismissal } from "@/lib/alertDismissal";

interface DismissibleAlertProps {
  alert: Alert;
  snoozeType: SnoozeType;
  onDismissed: (alertCode: string) => void;
  /** When provided, danger/warning alerts show a "Create action" button. */
  onCreateAction?: (prefill: Partial<ActionInsert>) => void;
}

const severityStyles: Record<
  Alert["severity"],
  { border: string; icon: string; titleColor: string; bg: string }
> = {
  danger:  { border: "var(--danger)", icon: "✕", titleColor: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 6%, var(--surface))" },
  warning: { border: "var(--warning)", icon: "⚠", titleColor: "var(--ink)", bg: "color-mix(in srgb, var(--warning) 6%, var(--surface))" },
  success: { border: "var(--success)", icon: "✓", titleColor: "var(--color-success-text)", bg: "color-mix(in srgb, var(--success) 6%, var(--surface))" },
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
      role={visible ? "alert" : undefined}
      aria-hidden={!visible}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        backgroundColor: "var(--navy)",
        color: "var(--surface)",
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
  onCreateAction,
}: DismissibleAlertProps) {
  const s = severityStyles[alert.severity];
  const actionPrefill = onCreateAction ? alertToActionPrefill(alert) : null;
  const canDismiss = alert.severity !== "danger" && !isProtectedAlertCode(alert.code);
  const [pending, setPending] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState(DISMISS_ALERT_ERROR);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  async function handleDismiss() {
    if (!canDismiss || pending) return;
    setPending(true);
    setToastVisible(false);
    try {
      await requestAlertDismissal(alert.code, snoozeType);
      // Keep the component mounted until confirmation so failure feedback
      // remains visible and a failed request never hides the alert.
      onDismissed(alert.code);
    } catch (error) {
      setToastMessage(error instanceof Error && error.message === DATA_RELOAD_DISMISS_ERROR
        ? DATA_RELOAD_DISMISS_ERROR : DISMISS_ALERT_ERROR);
      setToastVisible(true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastVisible(false), 6000);
    } finally {
      setPending(false);
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
            fontWeight: 500,
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
          {actionPrefill && (
            <button
              type="button"
              onClick={() => onCreateAction?.(actionPrefill)}
              className="transition-opacity hover:opacity-75"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 8,
                fontSize: 12,
                fontWeight: 500,
                color: "var(--teal)",
                backgroundColor: "var(--surface)",
                border: "1px solid var(--teal)",
                borderRadius: "var(--radius-md)",
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              <Plus size={12} />
              Create action
            </button>
          )}
        </div>

        {canDismiss && (
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={handleDismiss}
            title={pending ? "Dismissing alert..." : TOOLTIP_TEXT[snoozeType]}
            aria-label={pending ? "Dismissing alert..." : TOOLTIP_TEXT[snoozeType]}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "transparent",
              color: "var(--dim)",
              border: "none",
              cursor: pending ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "rgba(0,0,0,0.06)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--dim)";
            }}
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <X size={12} strokeWidth={2.5} />}
          </button>
        )}
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </>
  );
}
