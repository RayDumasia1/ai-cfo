"use client";

import { useState } from "react";
import type { BusinessProfile } from "@/lib/types";

interface ThresholdsCardProps {
  profile: BusinessProfile;
}

interface FormState {
  runway_warning_threshold: string;
  runway_danger_threshold: string;
  min_cash_reserve: string;
  burn_rate_warning_pct: string;
}

type SaveState = "idle" | "saving" | "success" | "error";

export default function ThresholdsCard({ profile }: ThresholdsCardProps) {
  const [form, setForm] = useState<FormState>({
    runway_warning_threshold: String(profile.runway_warning_threshold ?? 6),
    runway_danger_threshold:  String(profile.runway_danger_threshold ?? 3),
    min_cash_reserve:         String(profile.min_cash_reserve ?? ""),
    // Profile stores as decimal (0.10) → display as % (10)
    burn_rate_warning_pct:    String(
      profile.burn_rate_warning_pct != null
        ? Math.round(profile.burn_rate_warning_pct * 100)
        : 10
    ),
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setValidationError(null);
    setServerError(null);
  }

  function validate(): boolean {
    const warn = Number(form.runway_warning_threshold);
    const danger = Number(form.runway_danger_threshold);

    if (Number.isNaN(warn) || Number.isNaN(danger) ||
        Number.isNaN(Number(form.min_cash_reserve)) ||
        Number.isNaN(Number(form.burn_rate_warning_pct))) {
      setValidationError("All fields must be valid numbers.");
      return false;
    }
    if (danger >= warn) {
      setValidationError("Danger threshold must be less than warning threshold.");
      return false;
    }
    if (warn <= 0 || danger <= 0 || Number(form.burn_rate_warning_pct) <= 0) {
      setValidationError("All values must be greater than zero.");
      return false;
    }
    if (Number(form.min_cash_reserve) < 0) {
      setValidationError("Minimum cash reserve cannot be negative.");
      return false;
    }
    return true;
  }

  async function handleSave() {
    if (!validate()) return;

    setSaveState("saving");
    setServerError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runway_warning_threshold: Number(form.runway_warning_threshold),
          runway_danger_threshold:  Number(form.runway_danger_threshold),
          min_cash_reserve:         Number(form.min_cash_reserve),
          burn_rate_warning_pct:    Number(form.burn_rate_warning_pct),
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setServerError(json.error ?? "Failed to save.");
        setSaveState("error");
        return;
      }

      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setServerError("Network error. Please try again.");
      setSaveState("error");
    }
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Financial Thresholds</h2>
      <p style={cardDescStyle}>
        These thresholds control when alerts are triggered on your dashboard.
      </p>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <Field
          id="runway-warning-threshold"
          name="runway_warning_threshold"
          label="Runway warning threshold (months)"
          helper="Amber alert when runway drops below this"
          value={form.runway_warning_threshold}
          onChange={(v) => handleChange("runway_warning_threshold", v)}
          type="number"
          min={1}
        />
        <Field
          id="runway-danger-threshold"
          name="runway_danger_threshold"
          label="Runway danger threshold (months)"
          helper="Red alert when runway drops below this"
          value={form.runway_danger_threshold}
          onChange={(v) => handleChange("runway_danger_threshold", v)}
          type="number"
          min={1}
        />
        <Field
          id="min-cash-reserve"
          name="min_cash_reserve"
          label="Minimum cash reserve ($)"
          helper="Alert when cash drops below this amount"
          value={form.min_cash_reserve}
          onChange={(v) => handleChange("min_cash_reserve", v)}
          type="number"
          min={0}
          prefix="$"
        />
        <Field
          id="burn-rate-warning"
          name="burn_rate_warning_pct"
          label="Burn rate warning (%)"
          helper="Alert when monthly burn increases by more than this percentage"
          value={form.burn_rate_warning_pct}
          onChange={(v) => handleChange("burn_rate_warning_pct", v)}
          type="number"
          min={1}
          suffix="%"
        />
      </div>

      {validationError && (
        <p style={{ fontSize: 12, color: "#ef4444", marginTop: 16 }}>
          {validationError}
        </p>
      )}
      {serverError && (
        <p style={{ fontSize: 12, color: "#ef4444", marginTop: 16 }}>
          {serverError}
        </p>
      )}

      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saveState === "saving"}
          style={{
            ...primaryBtnStyle,
            opacity: saveState === "saving" ? 0.7 : 1,
            cursor: saveState === "saving" ? "default" : "pointer",
          }}
        >
          {saveState === "saving" ? "Saving…" : "Save thresholds"}
        </button>
        {saveState === "success" && (
          <span style={{ fontSize: 13, color: "#2CA6A4" }}>
            Thresholds saved ✓
          </span>
        )}
      </div>
    </section>
  );
}

// ── Field sub-component ───────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  name: string;
  label: string;
  helper: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  min?: number;
  prefix?: string;
  suffix?: string;
}

function Field({ id, name, label, helper, value, onChange, type = "text", min, prefix, suffix }: FieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <div style={{ position: "relative", marginTop: 6 }}>
        {prefix && (
          <span style={{
            position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
            fontSize: 14, color: "#6B7A8D", pointerEvents: "none",
          }}>
            {prefix}
          </span>
        )}
        <input
          id={id}
          name={name}
          type={type}
          min={min}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%",
            maxWidth: 220,
            padding: prefix ? "8px 12px 8px 24px" : suffix ? "8px 32px 8px 12px" : "8px 12px",
            fontSize: 14,
            color: "#344150",
            backgroundColor: "#FFFFFF",
            border: focused ? "1.5px solid #2CA6A4" : "1.5px solid #D8E2EC",
            borderRadius: 10,
            outline: "none",
            boxShadow: focused ? "0 0 0 3px rgba(44,166,164,0.12)" : "none",
            boxSizing: "border-box",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
        />
        {suffix && (
          <span style={{
            position: "absolute", right: "calc(100% - 220px + 12px)", top: "50%",
            transform: "translateY(-50%)", fontSize: 14, color: "#6B7A8D",
            pointerEvents: "none",
          }}>
            {suffix}
          </span>
        )}
      </div>
      <p style={helperStyle}>{helper}</p>
    </div>
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
  display: "block",
};

const helperStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6B7A8D",
  marginTop: 4,
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
