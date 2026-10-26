/**
 * Action Tracker — pure helpers shared by the API routes and UI.
 * No DB or React here: labels, alert → action pre-fill, input validation,
 * and tier limit state.
 */

import { USAGE_LIMITS, type FeatureTier } from "./featureGates";
import type {
  Action,
  ActionGoalType,
  ActionGoalUnit,
  ActionInsert,
  ActionStatus,
  ActionUpdate,
  Alert,
  AlertCode,
} from "./types";

export const ACTION_NAME_MAX = 200;
export const ACTION_TEXT_MAX = 500;

export const GOAL_TYPES: ActionGoalType[] = [
  "revenue_increase",
  "expense_reduction",
  "runway_improvement",
  "risk_mitigation",
];

export const GOAL_UNITS: ActionGoalUnit[] = ["usd", "percent", "months", "units"];

export const ACTION_STATUSES: ActionStatus[] = ["not_started", "in_progress", "completed"];

/** Plain-English answers to "What are you trying to do?" */
export const GOAL_TYPE_PROMPTS: Record<ActionGoalType, string> = {
  revenue_increase:   "Grow revenue",
  expense_reduction:  "Reduce expenses",
  runway_improvement: "Extend my runway",
  risk_mitigation:    "Reduce a risk",
};

/** Short labels for action rows. */
export const GOAL_TYPE_LABELS: Record<ActionGoalType, string> = {
  revenue_increase:   "Revenue",
  expense_reduction:  "Expenses",
  runway_improvement: "Runway",
  risk_mitigation:    "Risk",
};

export const GOAL_UNIT_LABELS: Record<ActionGoalUnit, string> = {
  usd:     "$",
  percent: "%",
  months:  "months",
  units:   "units",
};

/** Sensible default unit when a goal type is first picked. */
export const DEFAULT_GOAL_UNIT: Record<ActionGoalType, ActionGoalUnit> = {
  revenue_increase:   "usd",
  expense_reduction:  "usd",
  runway_improvement: "months",
  risk_mitigation:    "units",
};

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed:   "Completed",
};

// ─── Alert → Action pre-fill ──────────────────────────────────────────────────

const ALERT_ACTION_PREFILL: Partial<
  Record<AlertCode, { name: string; goal_type: ActionGoalType; description: string }>
> = {
  CASH_BELOW_RESERVE: {
    name: "Rebuild cash reserve",
    goal_type: "expense_reduction",
    description: "Cash balance is back above my minimum reserve",
  },
  RUNWAY_DANGER: {
    name: "Extend cash runway",
    goal_type: "runway_improvement",
    description: "Runway extended to a safe level",
  },
  RUNWAY_WARNING: {
    name: "Extend cash runway",
    goal_type: "runway_improvement",
    description: "Runway is above my warning threshold",
  },
  BURN_RATE_SPIKE: {
    name: "Reduce monthly burn",
    goal_type: "expense_reduction",
    description: "Monthly burn is back in line with previous months",
  },
  HIGH_AR: {
    name: "Collect outstanding invoices",
    goal_type: "revenue_increase",
    description: "Outstanding invoices are collected and cash is in",
  },
  AVAILABLE_CASH_BELOW_RESERVE: {
    name: "Rebuild available cash reserve",
    goal_type: "expense_reduction",
    description: "Available cash is back above my minimum reserve",
  },
  OPERATING_RUNWAY_DANGER: {
    name: "Improve operating cash runway",
    goal_type: "runway_improvement",
    description: "Operating runway is above my danger threshold",
  },
  OPERATING_RUNWAY_WARNING: {
    name: "Improve operating cash runway",
    goal_type: "runway_improvement",
    description: "Operating runway is above my warning threshold",
  },
  OPERATING_SPENDING_INCREASE: {
    name: "Review operating cash spending",
    goal_type: "expense_reduction",
    description: "Operating cash spending is back in line with recent months",
  },
  CUSTOMER_COLLECTIONS_ZERO: {
    name: "Review customer collections",
    goal_type: "revenue_increase",
    description: "Confirm the zero is accurate and follow up on any delayed customer payments",
  },
};

/**
 * Returns the action pre-fill for a danger/warning alert, or null when the
 * alert shouldn't offer "Create action" (success alerts, unmapped codes).
 * The description is outcome-framed ("what success looks like"), not the
 * alert's diagnostic message — it's an editable example for the user.
 */
export function alertToActionPrefill(alert: Alert): Partial<ActionInsert> | null {
  if (alert.severity !== "danger" && alert.severity !== "warning") return null;
  const mapped = ALERT_ACTION_PREFILL[alert.code];
  if (!mapped) return null;
  return {
    name: mapped.name,
    goal_type: mapped.goal_type,
    description: mapped.description,
    linked_alert_code: alert.code,
  };
}

// ─── Limits ───────────────────────────────────────────────────────────────────

export type ActionLimitState = {
  /** null = unlimited */
  limit: number | null;
  activeCount: number;
  atLimit: boolean;
  /** At 80%+ of the limit but not yet at it. */
  nearLimit: boolean;
};

/** Recognize only the dedicated database capacity signal, never arbitrary errors. */
export function getActionCapacityError(error: unknown): { limit: number } | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const value = error as Record<string, unknown>;
  if (value.code !== "P0001" || value.message !== "action_limit_reached" ||
      typeof value.details !== "string" || !/^(0|[1-9]\d*)$/.test(value.details)) return null;
  const limit = Number(value.details);
  const supported = Object.values(USAGE_LIMITS).some(tier => tier.actions_active === limit);
  return Number.isSafeInteger(limit) && supported ? { limit } : null;
}

export function isActiveAction(action: Pick<Action, "status">): boolean {
  return action.status !== "completed";
}

export function getActionLimitState(
  tier: FeatureTier,
  activeCount: number
): ActionLimitState {
  const limit = USAGE_LIMITS[tier]?.actions_active ?? null;
  if (limit === null) {
    return { limit, activeCount, atLimit: false, nearLimit: false };
  }
  const atLimit = activeCount >= limit;
  return {
    limit,
    activeCount,
    atLimit,
    nearLimit: !atLimit && activeCount >= limit * 0.8,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalText(v: unknown, field: string, max: number): ValidationResult<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = v.trim();
  if (trimmed.length > max) return { ok: false, error: `${field} must be ${max} characters or fewer` };
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function optionalNumber(v: unknown, field: string): ValidationResult<number | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return { ok: false, error: `${field} must be a number` };
  }
  return { ok: true, value: n };
}

function optionalEnum<T extends string>(
  v: unknown,
  field: string,
  allowed: readonly T[]
): ValidationResult<T | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    return { ok: false, error: `${field} must be one of ${allowed.join(", ")}` };
  }
  return { ok: true, value: v as T };
}

function optionalDate(v: unknown, field: string): ValidationResult<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    return { ok: false, error: `${field} must be a YYYY-MM-DD date` };
  }
  return { ok: true, value: v };
}

function validateName(v: unknown): ValidationResult<string> {
  if (typeof v !== "string" || v.trim() === "") return { ok: false, error: "name is required" };
  const name = v.trim();
  if (name.length > ACTION_NAME_MAX) {
    return { ok: false, error: `name must be ${ACTION_NAME_MAX} characters or fewer` };
  }
  return { ok: true, value: name };
}

function validateGoalType(v: unknown): ValidationResult<ActionGoalType> {
  if (typeof v !== "string" || !GOAL_TYPES.includes(v as ActionGoalType)) {
    return { ok: false, error: `goal_type must be one of ${GOAL_TYPES.join(", ")}` };
  }
  return { ok: true, value: v as ActionGoalType };
}

/**
 * Validates a POST /api/actions body. Unknown fields are dropped;
 * user_id and business_id are never accepted from the client.
 */
export function validateActionCreate(
  body: unknown
): ValidationResult<Omit<ActionInsert, "user_id">> {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON body" };

  const name = validateName(body.name);
  if (!name.ok) return name;
  const goalType = validateGoalType(body.goal_type);
  if (!goalType.ok) return goalType;

  const description = optionalText(body.description, "description", ACTION_TEXT_MAX);
  if (!description.ok) return description;
  const goalValue = optionalNumber(body.goal_value, "goal_value");
  if (!goalValue.ok) return goalValue;
  const goalUnit = optionalEnum(body.goal_unit, "goal_unit", GOAL_UNITS);
  if (!goalUnit.ok) return goalUnit;
  const status = optionalEnum(body.status, "status", ACTION_STATUSES);
  if (!status.ok) return status;
  const dueDate = optionalDate(body.due_date, "due_date");
  if (!dueDate.ok) return dueDate;
  const linkedAlert = optionalText(body.linked_alert_code, "linked_alert_code", 64);
  if (!linkedAlert.ok) return linkedAlert;
  const linkedVersion = optionalText(body.linked_forecast_version_id, "linked_forecast_version_id", 36);
  if (!linkedVersion.ok || (linkedVersion.value !== null && !UUID_RE.test(linkedVersion.value)))
    return { ok: false, error: "linked_forecast_version_id must be a UUID" };
  const linkedItem = optionalText(body.linked_forecast_item_id, "linked_forecast_item_id", 36);
  if (!linkedItem.ok || (linkedItem.value !== null && !UUID_RE.test(linkedItem.value)))
    return { ok: false, error: "linked_forecast_item_id must be a UUID" };
  if (linkedItem.value !== null && linkedVersion.value === null)
    return { ok: false, error: "linked_forecast_item_id requires linked_forecast_version_id" };
  const actualImpact = optionalNumber(body.actual_impact, "actual_impact");
  if (!actualImpact.ok) return actualImpact;
  const actualNotes = optionalText(body.actual_impact_notes, "actual_impact_notes", ACTION_TEXT_MAX);
  if (!actualNotes.ok) return actualNotes;

  return {
    ok: true,
    value: {
      business_id: null,
      name: name.value,
      description: description.value,
      goal_type: goalType.value,
      goal_value: goalValue.value,
      goal_unit: goalUnit.value,
      status: status.value ?? "not_started",
      due_date: dueDate.value,
      linked_alert_code: linkedAlert.value,
      linked_forecast_version_id: linkedVersion.value,
      linked_forecast_item_id: linkedItem.value,
      actual_impact: actualImpact.value,
      actual_impact_notes: actualNotes.value,
    },
  };
}

/**
 * Validates a PATCH /api/actions/[id] body. Only fields present in the body
 * are returned; at least one editable field is required.
 */
export function validateActionUpdate(body: unknown): ValidationResult<ActionUpdate> {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON body" };

  const update: ActionUpdate = {};

  if ("name" in body) {
    const r = validateName(body.name);
    if (!r.ok) return r;
    update.name = r.value;
  }
  if ("goal_type" in body) {
    const r = validateGoalType(body.goal_type);
    if (!r.ok) return r;
    update.goal_type = r.value;
  }
  if ("status" in body) {
    const r = optionalEnum(body.status, "status", ACTION_STATUSES);
    if (!r.ok) return r;
    if (r.value === null) return { ok: false, error: "status cannot be empty" };
    update.status = r.value;
  }
  if ("description" in body) {
    const r = optionalText(body.description, "description", ACTION_TEXT_MAX);
    if (!r.ok) return r;
    update.description = r.value;
  }
  if ("goal_value" in body) {
    const r = optionalNumber(body.goal_value, "goal_value");
    if (!r.ok) return r;
    update.goal_value = r.value;
  }
  if ("goal_unit" in body) {
    const r = optionalEnum(body.goal_unit, "goal_unit", GOAL_UNITS);
    if (!r.ok) return r;
    update.goal_unit = r.value;
  }
  if ("due_date" in body) {
    const r = optionalDate(body.due_date, "due_date");
    if (!r.ok) return r;
    update.due_date = r.value;
  }
  if ("linked_alert_code" in body) {
    const r = optionalText(body.linked_alert_code, "linked_alert_code", 64);
    if (!r.ok) return r;
    update.linked_alert_code = r.value;
  }
  if ("actual_impact" in body) {
    const r = optionalNumber(body.actual_impact, "actual_impact");
    if (!r.ok) return r;
    update.actual_impact = r.value;
  }
  if ("actual_impact_notes" in body) {
    const r = optionalText(body.actual_impact_notes, "actual_impact_notes", ACTION_TEXT_MAX);
    if (!r.ok) return r;
    update.actual_impact_notes = r.value;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "No editable fields provided" };
  }
  return { ok: true, value: update };
}
