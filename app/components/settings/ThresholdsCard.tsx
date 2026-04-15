"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { BusinessProfile } from "@/lib/types";

interface ThresholdsCardProps {
  profile: BusinessProfile;
}

interface Values {
  runway_warning_threshold: string;
  runway_danger_threshold: string;
  min_cash_reserve: string;
  burn_rate_warning_pct: string;
}

type SaveState = "idle" | "saving" | "success" | "error";

function initValues(profile: BusinessProfile): Values {
  return {
    runway_warning_threshold: String(profile.runway_warning_threshold ?? 6),
    runway_danger_threshold:  String(profile.runway_danger_threshold ?? 3),
    min_cash_reserve:         String(profile.min_cash_reserve ?? ""),
    burn_rate_warning_pct:    String(
      profile.burn_rate_warning_pct != null
        ? Math.round(profile.burn_rate_warning_pct * 100)
        : 10
    ),
  };
}

// Formatted display strings for saved value indicators
function formatSaved(field: keyof Values, raw: string): string {
  if (field === "min_cash_reserve") {
    const n = Number(raw);
    return "$" + (Number.isNaN(n) ? raw : n.toLocaleString());
  }
  if (field === "burn_rate_warning_pct") return raw + "%";
  return raw;
}

export default function ThresholdsCard({ profile }: ThresholdsCardProps) {
  const [savedValues, setSavedValues] = useState<Values>(() => initValues(profile));
  const [currentValues, setCurrentValues] = useState<Values>(() => initValues(profile));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const dirtyCount = (Object.keys(currentValues) as (keyof Values)[])
    .filter((k) => currentValues[k] !== savedValues[k]).length;

  function handleChange(field: keyof Values, value: string) {
    setCurrentValues((prev) => ({ ...prev, [field]: value }));
    setValidationError(null);
    setServerError(null);
  }

  function resetField(field: keyof Values) {
    setCurrentValues((prev) => ({ ...prev, [field]: savedValues[field] }));
  }

  function validate(): boolean {
    const warn   = Number(currentValues.runway_warning_threshold);
    const danger = Number(currentValues.runway_danger_threshold);

    if (Number.isNaN(warn) || Number.isNaN(danger) ||
        Number.isNaN(Number(currentValues.min_cash_reserve)) ||
        Number.isNaN(Number(currentValues.burn_rate_warning_pct))) {
      setValidationError("All fields must be valid numbers.");
      return false;
    }
    if (danger >= warn) {
      setValidationError("Danger threshold must be less than warning threshold.");
      return false;
    }
    if (warn <= 0 || danger <= 0 || Number(currentValues.burn_rate_warning_pct) <= 0) {
      setValidationError("All values must be greater than zero.");
      return false;
    }
    if (Number(currentValues.min_cash_reserve) < 0) {
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
          runway_warning_threshold: Number(currentValues.runway_warning_threshold),
          runway_danger_threshold:  Number(currentValues.runway_danger_threshold),
          min_cash_reserve:         Number(currentValues.min_cash_reserve),
          burn_rate_warning_pct:    Number(currentValues.burn_rate_warning_pct),
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setServerError(json.error ?? "Failed to save.");
        setSaveState("error");
        return;
      }

      setSavedValues({ ...currentValues });
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setServerError("Network error. Please try again.");
      setSaveState("error");
    }
  }

  return (
    <section style={cardStyle}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
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
          value={currentValues.runway_warning_threshold}
          isDirty={currentValues.runway_warning_threshold !== savedValues.runway_warning_threshold}
          savedDisplay={formatSaved("runway_warning_threshold", savedValues.runway_warning_threshold)}
          onChange={(v) => handleChange("runway_warning_threshold", v)}
          onReset={() => resetField("runway_warning_threshold")}
          type="number"
          min={1}
        />
        <Field
          id="runway-danger-threshold"
          name="runway_danger_threshold"
          label="Runway danger threshold (months)"
          helper="Red alert when runway drops below this"
          value={currentValues.runway_danger_threshold}
          isDirty={currentValues.runway_danger_threshold !== savedValues.runway_danger_threshold}
          savedDisplay={formatSaved("runway_danger_threshold", savedValues.runway_danger_threshold)}
          onChange={(v) => handleChange("runway_danger_threshold", v)}
          onReset={() => resetField("runway_danger_threshold")}
          type="number"
          min={1}
        />
        <Field
          id="min-cash-reserve"
          name="min_cash_reserve"
          label="Minimum cash reserve ($)"
          helper="Alert when cash drops below this amount"
          value={currentValues.min_cash_reserve}
          isDirty={currentValues.min_cash_reserve !== savedValues.min_cash_reserve}
          savedDisplay={formatSaved("min_cash_reserve", savedValues.min_cash_reserve)}
          onChange={(v) => handleChange("min_cash_reserve", v)}
          onReset={() => resetField("min_cash_reserve")}
          type="number"
          min={0}
          prefix="$"
        />
        <Field
          id="burn-rate-warning"
          name="burn_rate_warning_pct"
          label="Burn rate warning (%)"
          helper="Alert when monthly burn increases by more than this percentage"
          value={currentValues.burn_rate_warning_pct}
          isDirty={currentValues.burn_rate_warning_pct !== savedValues.burn_rate_warning_pct}
          savedDisplay={formatSaved("burn_rate_warning_pct", savedValues.burn_rate_warning_pct)}
          onChange={(v) => handleChange("burn_rate_warning_pct", v)}
          onReset={() => resetField("burn_rate_warning_pct")}
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
        {saveState === "success" ? (
          <span style={{ fontSize: 13, color: "#2CA6A4" }}>Thresholds saved ✓</span>
        ) : dirtyCount > 0 ? (
          <span style={{ fontSize: 12, color: "#6B7A8D" }}>
            {dirtyCount} unsaved change{dirtyCount > 1 ? "s" : ""}
          </span>
        ) : null}
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
  isDirty: boolean;
  savedDisplay: string;
  onChange: (v: string) => void;
  onReset: () => void;
  type?: string;
  min?: number;
  prefix?: string;
  suffix?: string;
}

function Field({
  id, name, label, helper, value, isDirty, savedDisplay,
  onChange, onReset, type = "text", min, prefix, suffix,
}: FieldProps) {
  const [focused, setFocused] = useState(false);

  const showTeal = isDirty || focused;

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
            border: showTeal ? "1.5px solid #2CA6A4" : "1.5px solid #D8E2EC",
            borderRadius: 10,
            outline: "none",
            boxShadow: showTeal ? "0 0 0 3px rgba(44,166,164,0.12)" : "none",
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
      {/* Helper row — always shown; saved indicator appears right-aligned when dirty */}
      <div style={{ display: "flex", alignItems: "center", marginTop: 4 }}>
        <p style={{ ...helperStyle, margin: 0, flex: 1 }}>{helper}</p>
        {isDirty && (
          <div style={{
            display: "flex", alignItems: "center", gap: 4, marginLeft: "auto",
            animation: "fadeIn 0.15s ease",
          }}>
            <span style={{ fontSize: 11, color: "#6B7A8D", whiteSpace: "nowrap" }}>
              Saved: {savedDisplay}
            </span>
            <button
              type="button"
              onClick={onReset}
              title="Reset to saved value"
              aria-label="Reset to saved value"
              style={{
                background: "none", border: "none", padding: "2px",
                cursor: "pointer", display: "inline-flex", alignItems: "center",
                color: "#6B7A8D", flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#2CA6A4")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7A8D")}
            >
              <RotateCcw size={11} />
            </button>
          </div>
        )}
      </div>
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
