"use client";

import { useEffect, useState } from "react";

type SnoozeDuration = "data_reload" | "24h" | "7d";

const STORAGE_KEY = "elidan_snooze_duration";
const DEFAULT: SnoozeDuration = "24h";

const options: { value: SnoozeDuration; label: string }[] = [
  { value: "data_reload", label: "Until I reload data" },
  { value: "24h",         label: "24 hours" },
  { value: "7d",          label: "7 days" },
];

export default function AlertPreferencesCard() {
  const [selected, setSelected] = useState<SnoozeDuration>(DEFAULT);
  const [saved, setSaved] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as SnoozeDuration | null;
    if (stored && options.some((o) => o.value === stored)) {
      setSelected(stored);
    }
  }, []);

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, selected);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Alert Preferences</h2>
      <p style={cardDescStyle}>
        Configure how and when alerts are shown on your dashboard.
      </p>

      <div style={{ marginTop: 24 }}>
        <label style={labelStyle}>Snooze dismissed alerts for</label>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {options.map((opt) => (
            <label
              key={opt.value}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            >
              <input
                type="radio"
                name="snooze"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
                style={{ accentColor: "#2CA6A4", width: 16, height: 16 }}
              />
              <span style={{ fontSize: 14, color: "var(--ink)" }}>{opt.label}</span>
            </label>
          ))}
        </div>

        <p style={helperStyle}>
          Danger alerts (critical runway, cash below reserve) are always shown and
          cannot be snoozed.
        </p>
      </div>

      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={handleSave} style={primaryBtnStyle}>
          Save preferences
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#2CA6A4" }}>
            Preferences saved ✓
          </span>
        )}
      </div>
    </section>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#0A1A2F",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6B7A8D",
  marginTop: 4,
  marginBottom: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#344150",
};

const helperStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6B7A8D",
  marginTop: 12,
  lineHeight: 1.5,
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
