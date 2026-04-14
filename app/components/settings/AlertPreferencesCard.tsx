"use client";

import { useEffect, useState } from "react";
import type { SnoozeType } from "@/lib/types";

const LEGACY_KEY = "elidan_snooze_duration";

const options: { value: SnoozeType; label: string; id: string }[] = [
  { value: "data_reload", label: "Until I reload data", id: "snooze-data-reload" },
  { value: "24h",         label: "24 hours",            id: "snooze-24h"         },
  { value: "7d",          label: "7 days",              id: "snooze-7d"          },
];

type LoadState = "loading" | "ready";
type SaveState = "idle" | "saving" | "success" | "error";

export default function AlertPreferencesCard() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<SnoozeType>("24h");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // On mount: fetch from Supabase, migrate localStorage if needed
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/settings/preferences");

        if (res.ok) {
          const json = await res.json() as { snooze_duration: SnoozeType };
          const supabaseValue = json.snooze_duration;

          // Check for legacy localStorage value to migrate
          const legacy = localStorage.getItem(LEGACY_KEY) as SnoozeType | null;

          if (legacy && legacy !== supabaseValue) {
            // Migrate: push localStorage value up to Supabase
            await fetch("/api/settings/preferences", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ snooze_duration: legacy }),
            });
            setSelected(legacy);
          } else {
            setSelected(supabaseValue ?? "24h");
          }

          // Clear legacy key regardless
          localStorage.removeItem(LEGACY_KEY);
        }
      } catch {
        // Network failure — fall back to localStorage or default
        const legacy = localStorage.getItem(LEGACY_KEY) as SnoozeType | null;
        if (legacy) setSelected(legacy);
      } finally {
        setLoadState("ready");
      }
    }

    init();
  }, []);

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);

    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snooze_duration: selected }),
      });

      if (!res.ok) {
        const json = await res.json();
        setSaveError(json.error ?? "Failed to save.");
        setSaveState("error");
        return;
      }

      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveError("Network error. Please try again.");
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
            <span style={{ fontSize: 13, color: "#6B7A8D" }}>Loading…</span>
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
                  onChange={() => setSelected(opt.value)}
                  style={{ accentColor: "#2CA6A4", width: 16, height: 16 }}
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
        <p style={{ fontSize: 12, color: "#ef4444", marginTop: 12 }}>{saveError}</p>
      )}

      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={loadState === "loading" || saveState === "saving"}
          style={{
            ...primaryBtnStyle,
            opacity: loadState === "loading" || saveState === "saving" ? 0.7 : 1,
            cursor: loadState === "loading" || saveState === "saving" ? "default" : "pointer",
          }}
        >
          {saveState === "saving" ? "Saving…" : "Save preferences"}
        </button>
        {saveState === "success" && (
          <span style={{ fontSize: 13, color: "#2CA6A4" }}>Preferences saved ✓</span>
        )}
      </div>
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};
const cardTitleStyle: React.CSSProperties = {
  fontSize: 15, fontWeight: 600, color: "#0A1A2F", margin: 0,
};
const cardDescStyle: React.CSSProperties = {
  fontSize: 13, color: "#6B7A8D", marginTop: 4, marginBottom: 0,
};
const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: "#344150",
};
const helperStyle: React.CSSProperties = {
  fontSize: 12, color: "#6B7A8D", marginTop: 12, lineHeight: 1.5,
};
const primaryBtnStyle: React.CSSProperties = {
  backgroundColor: "#2CA6A4",
  color: "#FFFFFF",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
