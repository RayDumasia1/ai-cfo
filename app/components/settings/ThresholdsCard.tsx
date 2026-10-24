"use client";

import { useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import type { BusinessProfile } from "@/lib/types";
import { createThresholdEditor, thresholdValuesFromProfile, type ThresholdValues as Values } from "@/lib/thresholdSettings";

interface ThresholdsCardProps { profile: BusinessProfile; }

function formatSaved(field: keyof Values, raw: string): string {
  if (field === "min_cash_reserve") {
    if (raw === "") return "Not set";
    return "$" + Number(raw).toLocaleString();
  }
  if (field === "burn_rate_warning_pct") return raw + "%";
  return raw;
}

const columnHeaderStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, textTransform: "uppercase",
  letterSpacing: "0.08em", color: "var(--dim)", margin: "0 0 16px",
};

export default function ThresholdsCard({ profile }: ThresholdsCardProps) {
  const [editor] = useState(() => createThresholdEditor(thresholdValuesFromProfile(profile)));
  const { current: currentValues, saved: savedValues, previous: previousValues,
    status: saveState, validationError, serverError } = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const dirtyCount = (Object.keys(currentValues) as (keyof Values)[])
    .filter(key => currentValues[key] !== savedValues[key]).length;
  const handleChange = editor.change;
  const resetField = editor.reset;
  const resetToPrevious = editor.restore;

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
      <form noValidate aria-busy={saveState === "saving"} onSubmit={event => { event.preventDefault(); void editor.save(); }}>
      <fieldset disabled={saveState === "saving"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="sr-only">Financial alert thresholds</legend>
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
              type="number" min={0}
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
              type="number" min={0}
            />
          </div>
        </div>

        {/* Right column — Cash & Burn */}
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 24 }}>
          <p style={columnHeaderStyle}>Cash & Burn</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Field
              id="min-cash-reserve"
              name="min_cash_reserve"
              label="Minimum cash reserve ($)"
              helper="Alert when cash drops below this amount. Leave blank to disable this alert."
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
              type="number" min={0} suffix="%"
            />
          </div>
        </div>
      </div>

      {validationError && (
        <p role="alert" style={{ fontSize: 12, color: "var(--danger)", marginTop: 16 }}>
          {validationError}
        </p>
      )}
      {serverError && (
        <p role="alert" style={{ fontSize: 12, color: "var(--danger)", marginTop: 16 }}>
          {serverError}
        </p>
      )}

      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="submit"
          disabled={saveState === "saving" || dirtyCount === 0}
          style={{
            ...primaryBtnStyle,
            opacity: saveState === "saving" ? 0.7 : 1,
            cursor: saveState === "saving" ? "default" : "pointer",
          }}
        >
          {saveState === "saving" ? "Saving…" : "Save thresholds"}
        </button>
        {saveState === "success" ? (
          <span role="status" style={{ fontSize: 13, color: "var(--color-success-text)" }}>Thresholds saved ✓</span>
        ) : dirtyCount > 0 ? (
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            {dirtyCount} unsaved change{dirtyCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      </fieldset>
      </form>
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
              fontSize: 14, color: "var(--dim)", pointerEvents: "none",
            }}>
              {prefix}
            </span>
          )}
          <input
            id={id}
            name={name}
            type={type}
            min={min}
            step={type === "number" ? "any" : undefined}
            aria-describedby={`${id}-help`}
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              width: "100%",
              padding: prefix ? "8px 12px 8px 24px" : suffix ? "8px 32px 8px 12px" : "8px 12px",
              fontSize: 14,
              color: "var(--ink)",
              backgroundColor: "var(--surface)",
              border: showTeal ? "1.5px solid var(--teal)" : "1.5px solid var(--line)",
              borderRadius: 10,
              outline: "none",
              boxShadow: showTeal ? "0 0 0 3px color-mix(in srgb, var(--teal) 12%, transparent)" : "none",
              boxSizing: "border-box",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          />
          {suffix && (
            <span style={{
              position: "absolute", right: 12, top: "50%",
              transform: "translateY(-50%)", fontSize: 14, color: "var(--dim)",
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
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              {indicator === "dirty" ? `Saved: ${savedDisplay}` : `Previous: ${previousDisplay}`}
            </span>
            <button
              type="button"
              onClick={indicator === "dirty" ? onReset : onResetToPrevious}
              title={indicator === "dirty" ? "Reset to saved value" : "Restore previous value"}
              aria-label={`${indicator === "dirty" ? "Reset to saved value" : "Restore previous value"}: ${label}`}
              style={{
                background: "none", border: "none", padding: "2px",
                cursor: "pointer", display: "inline-flex", alignItems: "center",
                color: "var(--dim)", flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--teal)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
            >
              <RotateCcw size={11} />
            </button>
          </div>
        )}
      </div>
      {/* Row 3 — helper text */}
      <p id={`${id}-help`} style={helperStyle}>{helper}</p>
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  boxShadow: "var(--shadow-sm)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 500,
  color: "var(--navy)",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--dim)",
  marginTop: 4,
  marginBottom: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "var(--ink)",
  display: "block",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const helperStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--dim)",
  marginTop: 4,
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
