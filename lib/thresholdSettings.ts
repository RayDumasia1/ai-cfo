import type { BusinessProfile } from "./types";
import { percentageFromDecimal, percentageToDecimal } from "./calculations";

export interface ThresholdValues {
  runway_warning_threshold: string;
  runway_danger_threshold: string;
  min_cash_reserve: string;
  burn_rate_warning_pct: string;
}
export interface ThresholdPayload {
  runway_warning_threshold: number;
  runway_danger_threshold: number;
  min_cash_reserve: number | null;
  /** UI percentage, not the stored decimal fraction. */
  burn_rate_warning_pct: number;
}
export const THRESHOLD_FIELDS: (keyof ThresholdValues)[] = [
  "runway_warning_threshold", "runway_danger_threshold", "min_cash_reserve", "burn_rate_warning_pct",
];
export const THRESHOLD_SAVE_ERROR = "Could not confirm the save. Please retry or refresh to check the saved values.";

export function thresholdValuesFromProfile(profile: BusinessProfile): ThresholdValues {
  return {
    runway_warning_threshold: String(profile.runway_warning_threshold ?? 6),
    runway_danger_threshold: String(profile.runway_danger_threshold ?? 3),
    min_cash_reserve: profile.min_cash_reserve == null ? "" : String(profile.min_cash_reserve),
    burn_rate_warning_pct: String(percentageFromDecimal(profile.burn_rate_warning_pct ?? 0.1)),
  };
}

export function thresholdEditorKey(profile: BusinessProfile): string {
  return JSON.stringify([profile.user_id, ...THRESHOLD_FIELDS.map(field => profile[field])]);
}

export function parseThresholdValues(values: ThresholdValues): { ok: true; value: ThresholdPayload } | { ok: false; error: string } {
  const warn = Number(values.runway_warning_threshold);
  const danger = Number(values.runway_danger_threshold);
  const burn = Number(values.burn_rate_warning_pct);
  const reserve = values.min_cash_reserve.trim() === "" ? null : Number(values.min_cash_reserve);
  if (![warn, danger, burn].every(Number.isFinite) || (reserve !== null && !Number.isFinite(reserve))) {
    return { ok: false, error: "All entered values must be finite numbers." };
  }
  if (danger >= warn) return { ok: false, error: "Danger threshold must be less than warning threshold." };
  if (warn <= 0 || danger <= 0 || burn <= 0 || (reserve !== null && reserve < 0)) {
    return { ok: false, error: "Thresholds must be positive; cash reserve may be zero or blank." };
  }
  if (percentageToDecimal(burn) === 0) return { ok: false, error: "Burn rate warning percentage is too small to store." };
  return { ok: true, value: { runway_warning_threshold: warn, runway_danger_threshold: danger, min_cash_reserve: reserve, burn_rate_warning_pct: burn } };
}

function valuesFromPayload(value: ThresholdPayload): ThresholdValues {
  return {
    runway_warning_threshold: String(value.runway_warning_threshold),
    runway_danger_threshold: String(value.runway_danger_threshold),
    min_cash_reserve: value.min_cash_reserve === null ? "" : String(value.min_cash_reserve),
    burn_rate_warning_pct: String(value.burn_rate_warning_pct),
  };
}

export async function requestThresholdSave(values: ThresholdPayload): Promise<void> {
  try {
    const response = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
    });
    if (!response.ok) throw new Error("Rejected threshold save");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || !("success" in body) || body.success !== true) {
      throw new Error("Unconfirmed threshold save");
    }
  } catch { throw new Error(THRESHOLD_SAVE_ERROR); }
}

export interface ThresholdEditorState {
  current: ThresholdValues;
  saved: ThresholdValues;
  previous: Partial<ThresholdValues>;
  status: "idle" | "saving" | "success" | "error";
  validationError: string | null;
  serverError: string | null;
}

/** Observable workflow shared by React and async regression tests; no database access. */
export function createThresholdEditor(initial: ThresholdValues, persist = requestThresholdSave) {
  let state: ThresholdEditorState = { current: { ...initial }, saved: { ...initial }, previous: {}, status: "idle", validationError: null, serverError: null };
  const listeners = new Set<() => void>();
  function publish(update: Partial<ThresholdEditorState>) {
    state = { ...state, ...update };
    listeners.forEach(listener => listener());
  }
  async function commit(field?: keyof ThresholdValues) {
    if (state.status === "saving") return;
    if (!field && THRESHOLD_FIELDS.every(key => state.current[key] === state.saved[key])) return;
    const before = state;
    if (field && (before.previous[field] === undefined || before.current[field] !== before.saved[field])) return;
    const candidate = field ? { ...before.saved, [field]: before.previous[field]! } : { ...before.current };
    const parsed = parseThresholdValues(candidate);
    if (!parsed.ok) { publish({ validationError: parsed.error, serverError: null, status: "idle" }); return; }
    publish({ status: "saving", validationError: null, serverError: null });
    try {
      await persist(parsed.value);
      const confirmed = valuesFromPayload(parsed.value);
      if (field) {
        const previous = { ...before.previous };
        delete previous[field];
        publish({ saved: confirmed, current: { ...before.current, [field]: confirmed[field] }, previous, status: "success" });
      } else {
        const previous: Partial<ThresholdValues> = {};
        THRESHOLD_FIELDS.forEach(key => { if (confirmed[key] !== before.saved[key]) previous[key] = before.saved[key]; });
        publish({ saved: confirmed, current: confirmed, previous, status: "success" });
      }
    } catch { publish({ status: "error", serverError: THRESHOLD_SAVE_ERROR }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    change(field: keyof ThresholdValues, value: string) {
      if (state.status === "saving") return;
      publish({ current: { ...state.current, [field]: value }, validationError: null, serverError: null, status: "idle" });
    },
    reset(field: keyof ThresholdValues) {
      if (state.status === "saving") return;
      publish({ current: { ...state.current, [field]: state.saved[field] }, validationError: null, serverError: null, status: "idle" });
    },
    save: () => commit(),
    restore: (field: keyof ThresholdValues) => commit(field),
  };
}
