"use client";

import { useEffect, useRef, useState } from "react";
import type { SnoozeType } from "@/lib/types";

import { LOAD_PREFERENCES_ERROR, SAVE_PREFERENCES_ERROR, loadAlertPreference, saveAlertPreference } from "@/lib/alertPreferences";

const options: { value: SnoozeType; label: string; id: string }[] = [
  { value: "data_reload", label: "Until I reload data", id: "snooze-data-reload" },
  { value: "24h",         label: "24 hours",            id: "snooze-24h"         },
  { value: "7d",          label: "7 days",              id: "snooze-7d"          },
];

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "success" | "error";

export default function AlertPreferencesCard() {
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<SnoozeType>("24h");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const value = await loadAlertPreference();
        if (active) {
          setSelected(value);
          setLoadState("ready");
        }
      } catch {
        if (active) setLoadState("error");
      }
    }
    void init();
    return () => {
      active = false;
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [reloadAttempt]);

  async function handleSave() {
    if (loadState !== "ready" || saveState === "saving") return;
    if (successTimer.current) clearTimeout(successTimer.current);
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveAlertPreference(selected);
      setSaveState("success");
      successTimer.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveError(SAVE_PREFERENCES_ERROR);
      setSaveState("error");
    }
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Alert Preferences</h2>
      <p style={cardDescStyle}>
        Configure how and when alerts are shown on your dashboard.
      </p>

      <div style={{ marginTop: 24 }}>
        {/* Group label — not a <label> element since it doesn't map to a single control */}
        <p style={labelStyle} id="snooze-duration-group">Snooze dismissed alerts for</p>

        {loadState === "loading" ? (
          <div style={{ marginTop: 12, height: 80, display: "flex", alignItems: "center" }}>
            <span role="status" style={{ fontSize: 13, color: "var(--dim)" }}>Loading…</span>
          </div>
        ) : loadState === "error" ? (
          <div style={{ marginTop: 12 }}>
            <p role="alert" style={{ fontSize: 13, color: "var(--danger)" }}>{LOAD_PREFERENCES_ERROR}</p>
            <button type="button" onClick={() => { setLoadState("loading"); setReloadAttempt(value => value + 1); }} style={primaryBtnStyle}>
              Retry loading preferences
            </button>
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby="snooze-duration-group"
            style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}
          >
            {options.map((opt) => (
              <label
                key={opt.value}
                htmlFor={opt.id}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
              >
                <input
                  id={opt.id}
                  type="radio"
                  name="snooze-duration"
                  value={opt.value}
                  checked={selected === opt.value}
                  disabled={saveState === "saving"}
                  onChange={() => { setSelected(opt.value); setSaveState("idle"); setSaveError(null); }}
                  style={{ accentColor: "var(--teal)", width: 16, height: 16 }}
                />
                <span style={{ fontSize: 14, color: "var(--ink)" }}>{opt.label}</span>
              </label>
            ))}
          </div>
        )}

        <p style={helperStyle}>
          Danger alerts (critical runway, cash below reserve) are always shown and
          cannot be snoozed.
        </p>
      </div>

      {saveError && (
        <p role="alert" style={{ fontSize: 12, color: "var(--danger)", marginTop: 12 }}>{saveError}</p>
      )}

      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={loadState !== "ready" || saveState === "saving"}
          style={{
            ...primaryBtnStyle,
            opacity: loadState !== "ready" || saveState === "saving" ? 0.7 : 1,
            cursor: loadState !== "ready" || saveState === "saving" ? "default" : "pointer",
          }}
        >
          {saveState === "saving" ? "Saving…" : "Save preferences"}
        </button>
        {saveState === "success" && (
          <span role="status" style={{ fontSize: 13, color: "var(--teal)" }}>Preferences saved ✓</span>
        )}
      </div>
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};
const cardTitleStyle: React.CSSProperties = {
  fontSize: 18, fontWeight: 500, color: "var(--navy)", margin: 0,
};
const cardDescStyle: React.CSSProperties = {
  fontSize: 13, color: "var(--dim)", marginTop: 4, marginBottom: 0,
};
const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: "var(--ink)",
};
const helperStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--dim)", marginTop: 12, lineHeight: 1.5,
};
const primaryBtnStyle: React.CSSProperties = {
  backgroundColor: "var(--teal)",
  color: "var(--surface)",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
