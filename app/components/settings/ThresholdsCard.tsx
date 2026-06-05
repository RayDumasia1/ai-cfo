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

function formatSaved(field: keyof Values, raw: string): string {
  if (field === "min_cash_reserve") {
    const n = Number(raw);
    return "$" + (Number.isNaN(n) ? raw : n.toLocaleString());
  }
  if (field === "burn_rate_warning_pct") return raw + "%";
  return raw;
}

const columnHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#6B7A8D",
  margin: "0 0 16px",
};

export default function ThresholdsCard({ profile }: ThresholdsCardProps) {
  const [savedValues,    setSavedValues]    = useState<Values>(() => initValues(profile));
  const [currentValues,  setCurrentValues]  = useState<Values>(() => initValues(profile));
  // previousValues: fields that were changed in the last save — session-only, starts empty
  const [previousValues, setPreviousValues] = useState<Partial<Values>>({});
  const [saveState,      setSaveState]      = useState<SaveState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError,    setServerError]    = useState<string | null>(null);

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

  async function saveToDb(values: Values): Promise<boolean> {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runway_warning_threshold: Number(values.runway_warning_threshold),
        runway_danger_threshold:  Number(values.runway_danger_threshold),
        min_cash_reserve:         Number(values.min_cash_reserve),
        burn_rate_warning_pct:    Number(values.burn_rate_warning_pct),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setServerError(json.error ?? "Failed to save.");
      setSaveState("error");
      return false;
    }
    return true;
  }

  async function handleSave() {
    if (!validate()) return;

    setSaveState("saving");
    setServerError(null);

    try {
      const ok = await saveToDb(currentValues);
      if (!ok) return;

      // Capture only the fields that actually changed as "previous"
      const changed: Partial<Values> = {};
      (Object.keys(currentValues) as (keyof Values)[]).forEach((k) => {
        if (currentValues[k] !== savedValues[k]) changed[k] = savedValues[k];
      });
      setPreviousValues(changed);
      setSavedValues({ ...currentValues });
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setServerError("Network error. Please try again.");
      setSaveState("error");
    }
  }

  // Called when user clicks ↺ on a "Previous: X" indicator.
  // Restores the field to its previous value AND saves to the database.
  async function resetToPrevious(field: keyof Values) {
    const prev = previousValues[field];
    if (prev === undefined) return;

    const newCurrent = { ...currentValues, [field]: prev };
    const newSaved   = { ...savedValues,   [field]: prev };

    setCurrentValues(newCurrent);
    setSavedValues(newSaved);
    setPreviousValues((p) => { const n = { ...p }; delete n[field]; return n; });
    setServerError(null);
    setSaveState("saving");

    try {
      const ok = await saveToDb(newSaved);
      if (!ok) return;
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setServerError("Network error. Please try again.");
      setSaveState("error");
    }
  }

  // Derive per-field indicator state
  function fieldIndicator(field: keyof Values): "dirty" | "previous" | "clean" {
    if (currentValues[field] !== savedValues[field]) return "dirty";
    const prev = previousValues[field];
    if (prev !== undefined && prev !== savedValues[field]) return "previous";
    return "clean";
  }

  return (
    <section style={cardStyle}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <h2 style={cardTitleStyle}>Financial Thresholds</h2>
      <p style={cardDescStyle}>
        These thresholds control when alerts are triggered on your dashboard.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 }}>
        {/* Left column — Runway */}
        <div>
          <p style={columnHeaderStyle}>Runway</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Field
              id="runway-warning-threshold"
              name="runway_warning_threshold"
              label="Runway warning threshold (months)"
              helper="Amber alert when runway drops below this"
              value={currentValues.runway_warning_threshold}
              indicator={fieldIndicator("runway_warning_threshold")}
              savedDisplay={formatSaved("runway_warning_threshold", savedValues.runway_warning_threshold)}
              previousDisplay={previousValues.runway_warning_threshold !== undefined ? formatSaved("runway_warning_threshold", previousValues.runway_warning_threshold!) : ""}
              onChange={(v) => handleChange("runway_warning_threshold", v)}
              onReset={() => resetField("runway_warning_threshold")}
              onResetToPrevious={() => resetToPrevious("runway_warning_threshold")}
              type="number" min={1}
            />
            <Field
              id="runway-danger-threshold"
              name="runway_danger_threshold"
              label="Runway danger threshold (months)"
              helper="Red alert when runway drops below this"
              value={currentValues.runway_danger_threshold}
              indicator={fieldIndicator("runway_danger_threshold")}
              savedDisplay={formatSaved("runway_danger_threshold", savedValues.runway_danger_threshold)}
              previousDisplay={previousValues.runway_danger_threshold !== undefined ? formatSaved("runway_danger_threshold", previousValues.runway_danger_threshold!) : ""}
              onChange={(v) => handleChange("runway_danger_threshold", v)}
              onReset={() => resetField("runway_danger_threshold")}
              onResetToPrevious={() => resetToPrevious("runway_danger_threshold")}
              type="number" min={1}
            />
          </div>
        </div>

        {/* Right column — Cash & Burn */}
        <div style={{ borderLeft: "1px solid #D8E2EC", paddingLeft: 24 }}>
          <p style={columnHeaderStyle}>Cash & Burn</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Field
              id="min-cash-reserve"
              name="min_cash_reserve"
              label="Minimum cash reserve ($)"
              helper="Alert when cash drops below this amount"
              value={currentValues.min_cash_reserve}
              indicator={fieldIndicator("min_cash_reserve")}
              savedDisplay={formatSaved("min_cash_reserve", savedValues.min_cash_reserve)}
              previousDisplay={previousValues.min_cash_reserve !== undefined ? formatSaved("min_cash_reserve", previousValues.min_cash_reserve!) : ""}
              onChange={(v) => handleChange("min_cash_reserve", v)}
              onReset={() => resetField("min_cash_reserve")}
              onResetToPrevious={() => resetToPrevious("min_cash_reserve")}
              type="number" min={0} prefix="$"
            />
            <Field
              id="burn-rate-warning"
              name="burn_rate_warning_pct"
              label="Burn rate warning (%)"
              helper="Alert when monthly burn increases by more than this percentage"
              value={currentValues.burn_rate_warning_pct}
              indicator={fieldIndicator("burn_rate_warning_pct")}
              savedDisplay={formatSaved("burn_rate_warning_pct", savedValues.burn_rate_warning_pct)}
              previousDisplay={previousValues.burn_rate_warning_pct !== undefined ? formatSaved("burn_rate_warning_pct", previousValues.burn_rate_warning_pct!) : ""}
              onChange={(v) => handleChange("burn_rate_warning_pct", v)}
              onReset={() => resetField("burn_rate_warning_pct")}
              onResetToPrevious={() => resetToPrevious("burn_rate_warning_pct")}
              type="number" min={1} suffix="%"
            />
          </div>
        </div>
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
  indicator: "dirty" | "previous" | "clean";
  savedDisplay: string;
  previousDisplay: string;
  onChange: (v: string) => void;
  onReset: () => void;
  onResetToPrevious: () => void;
  type?: string;
  min?: number;
  prefix?: string;
  suffix?: string;
}

function Field({
  id, name, label, helper, value, indicator, savedDisplay, previousDisplay,
  onChange, onReset, onResetToPrevious, type = "text", min, prefix, suffix,
}: FieldProps) {
  const [focused, setFocused] = useState(false);

  const showTeal = indicator === "dirty" || focused;
  const showIndicator = indicator !== "clean";

  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {/* Row 2 — input + indicator side by side */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
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
              position: "absolute", right: 12, top: "50%",
              transform: "translateY(-50%)", fontSize: 14, color: "#6B7A8D",
              pointerEvents: "none",
            }}>
              {suffix}
            </span>
          )}
        </div>

        {showIndicator && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            whiteSpace: "nowrap", flexShrink: 0,
            animation: "fadeIn 0.15s ease",
          }}>
            <span style={{ fontSize: 12, color: "#6B7A8D" }}>
              {indicator === "dirty" ? `Saved: ${savedDisplay}` : `Previous: ${previousDisplay}`}
            </span>
            <button
              type="button"
              onClick={indicator === "dirty" ? onReset : onResetToPrevious}
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
      {/* Row 3 — helper text */}
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
  fontSize: 18,
  fontWeight: 500,
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
  fontSize: 11,
  fontWeight: 500,
  color: "#344150",
  display: "block",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
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
