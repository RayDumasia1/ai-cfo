/**
 * Action list view logic — filtering, sorting, overdue detection, and display
 * formatting for the Actions page and dashboard panel. Pure functions only.
 */

import type { Action, ActionGoalUnit } from "./types";

export type ActionFilter = "all" | "active" | "completed";

export const ACTION_FILTERS: ActionFilter[] = ["all", "active", "completed"];

export const ACTION_FILTER_LABELS: Record<ActionFilter, string> = {
  all:       "All",
  active:    "Active",
  completed: "Completed",
};

export const ACTION_EMPTY_MESSAGES: Record<ActionFilter, string> = {
  all:       "You haven't created any actions yet.",
  active:    "No active actions. Add one to start tracking your progress.",
  completed: "No completed actions yet. Mark an action complete to see it here.",
};

// ─── Dates ────────────────────────────────────────────────────────────────────

/** Today as YYYY-MM-DD in the viewer's local timezone. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Past its due date and not completed. `today` is YYYY-MM-DD (local). */
export function isOverdue(action: Pick<Action, "due_date" | "status">, today: string = localToday()): boolean {
  if (!action.due_date || action.status === "completed") return false;
  // YYYY-MM-DD strings compare correctly as text
  return action.due_date < today;
}

/** "2026-11-03" → "Nov 3", parsed as a local date so it never shifts a day. */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** ISO timestamp (e.g. completed_at) → "Nov 3" in the viewer's timezone. */
export function formatTimestampDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Filtering + sorting ──────────────────────────────────────────────────────

function byCreatedDesc(a: Action, b: Action): number {
  return b.created_at.localeCompare(a.created_at);
}

/** 0 = overdue, 1 = due today or later, 2 = no due date. */
function activeSortGroup(action: Action, today: string): number {
  if (isOverdue(action, today)) return 0;
  return action.due_date ? 1 : 2;
}

/**
 * Active sort order:
 *   1. Overdue — due date ascending (most overdue first)
 *   2. Due today or later — newest created first
 *   3. No due date — newest created first
 */
export function sortActiveActions(actions: Action[], today: string = localToday()): Action[] {
  return [...actions].sort((a, b) => {
    const ga = activeSortGroup(a, today);
    const gb = activeSortGroup(b, today);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const byDue = a.due_date!.localeCompare(b.due_date!);
      if (byDue !== 0) return byDue;
    }
    return byCreatedDesc(a, b);
  });
}

/** Number of active actions past their due date. */
export function countOverdue(actions: Action[], today: string = localToday()): number {
  return actions.filter((a) => isOverdue(a, today)).length;
}

export type TabCount = { count: number; overdue: number };

/** Per-tab counts. Only the Active tab carries an overdue count (0 = hide it). */
export function getTabCounts(actions: Action[], today: string = localToday()): Record<ActionFilter, TabCount> {
  const active = actions.filter((a) => a.status !== "completed");
  return {
    all:       { count: actions.length, overdue: 0 },
    active:    { count: active.length, overdue: countOverdue(active, today) },
    completed: { count: actions.length - active.length, overdue: 0 },
  };
}

/** Most recently completed first; missing completed_at sorts last. */
export function sortCompletedActions(actions: Action[]): Action[] {
  return [...actions].sort((a, b) => {
    if (!a.completed_at && !b.completed_at) return byCreatedDesc(a, b);
    if (!a.completed_at) return 1;
    if (!b.completed_at) return -1;
    return b.completed_at.localeCompare(a.completed_at);
  });
}

/**
 * Returns the actions for a filter tab, sorted for display.
 * "active" = not_started + in_progress. "all" = active (sorted) then completed (sorted).
 */
export function filterAndSortActions(
  actions: Action[],
  filter: ActionFilter,
  today: string = localToday()
): Action[] {
  const active = actions.filter((a) => a.status !== "completed");
  const completed = actions.filter((a) => a.status === "completed");

  switch (filter) {
    case "active":
      return sortActiveActions(active, today);
    case "completed":
      return sortCompletedActions(completed);
    case "all":
      return [...sortActiveActions(active, today), ...sortCompletedActions(completed)];
  }
}

// ─── Display ──────────────────────────────────────────────────────────────────

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const withCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** 4200 + usd → "$4,200"; 1234.5 + usd → "$1,234.50"; 12.5 + percent → "12.5%"; 1 + months → "1 month". */
export function formatActualImpact(value: number, unit: ActionGoalUnit | null): string {
  switch (unit) {
    case "usd":
      // Whole dollars stay clean ("$4,200"); real cents always show two digits ("$1,234.50")
      return (Number.isInteger(value) ? wholeDollars : withCents).format(value);
    case "percent":
      return `${numberFormat.format(value)}%`;
    case "months":
      return `${numberFormat.format(value)} ${Math.abs(value) === 1 ? "month" : "months"}`;
    case "units":
      return `${numberFormat.format(value)} ${Math.abs(value) === 1 ? "unit" : "units"}`;
    default:
      return numberFormat.format(value);
  }
}
