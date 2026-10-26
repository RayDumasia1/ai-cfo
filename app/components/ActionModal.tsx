"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import type {
  Action,
  ActionGoalType,
  ActionGoalUnit,
  ActionInsert,
  ActionStatus,
} from "@/lib/types";
import {
  ACTION_NAME_MAX,
  ACTION_STATUSES,
  ACTION_STATUS_LABELS,
  ACTION_TEXT_MAX,
  DEFAULT_GOAL_UNIT,
  GOAL_TYPES,
  GOAL_TYPE_PROMPTS,
  GOAL_UNITS,
  GOAL_UNIT_LABELS,
} from "@/lib/actions";

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the action returned by the API after a successful save. */
  onSave: (action: Action) => void;
  /** Called when the user confirms delete (edit mode only). */
  onDelete?: (action: Action) => void;
  prefill?: Partial<ActionInsert>;
  editAction?: Action;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--navy)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 14,
  fontWeight: 400,
  color: "var(--ink)",
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  padding: "9px 12px",
  outline: "none",
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 300,
  color: "var(--dim)",
  marginTop: 4,
};

function numberToInput(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

function inputToNumber(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Create / edit modal for Action Tracker.
 * Mode is determined by whether editAction is passed. Form state initialises
 * from props on mount — the parent remounts it (via key) on each open.
 */
export default function ActionModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  prefill,
  editAction,
}: ActionModalProps) {
  const isEdit = editAction !== undefined;
  const initial = editAction ?? prefill ?? {};

  const [name, setName] = useState(initial.name ?? "");
  const [goalType, setGoalType] = useState<ActionGoalType | "">(initial.goal_type ?? "");
  const [goalValue, setGoalValue] = useState(numberToInput(initial.goal_value));
  const [goalUnit, setGoalUnit] = useState<ActionGoalUnit>(
    initial.goal_unit ?? (initial.goal_type ? DEFAULT_GOAL_UNIT[initial.goal_type] : "usd")
  );
  const [description, setDescription] = useState(initial.description ?? "");
  const [dueDate, setDueDate] = useState(initial.due_date ?? "");
  const [status, setStatus] = useState<ActionStatus>(editAction?.status ?? "not_started");
  const [actualImpact, setActualImpact] = useState(numberToInput(editAction?.actual_impact));
  const [actualNotes, setActualNotes] = useState(editAction?.actual_impact_notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleGoalTypeChange(next: ActionGoalType | "") {
    setGoalType(next);
    // Only pick a default unit while the user hasn't entered an amount
    if (next && goalValue.trim() === "") setGoalUnit(DEFAULT_GOAL_UNIT[next]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim() === "") {
      setError("Give your action a name.");
      return;
    }
    if (!goalType) {
      setError("Choose what you're trying to do.");
      return;
    }

    const goalValueNum = inputToNumber(goalValue);
    const actualImpactNum = inputToNumber(actualImpact);
    const usesUnit = goalValueNum !== null || (status === "completed" && actualImpactNum !== null);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      goal_type: goalType,
      goal_value: goalValueNum,
      goal_unit: usesUnit ? goalUnit : null,
      description: description.trim() || null,
      due_date: dueDate || null,
    };

    if (isEdit) {
      payload.status = status;
      if (status === "completed") {
        payload.actual_impact = actualImpactNum;
        payload.actual_impact_notes = actualNotes.trim() || null;
      }
    } else {
      if (prefill?.linked_alert_code) payload.linked_alert_code = prefill.linked_alert_code;
      if (prefill?.linked_forecast_version_id) payload.linked_forecast_version_id = prefill.linked_forecast_version_id;
      if (prefill?.linked_forecast_item_id) payload.linked_forecast_item_id = prefill.linked_forecast_item_id;
    }

    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/actions/${editAction.id}` : "/api/actions", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error === "limit_reached") {
          setError(
            `You've reached your limit of ${data.limit} active actions. Complete or delete one first.`
          );
        } else {
          setError(typeof data.error === "string" ? data.error : "Couldn't save — please try again.");
        }
        return;
      }

      onSave(data as Action);
    } catch {
      setError("Couldn't save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "rgba(10,26,47,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
          padding: 24,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 id="action-modal-title" style={{ fontSize: 18, fontWeight: 500, color: "var(--navy)" }}>
            {isEdit ? "Edit action" : "New action"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="transition-opacity hover:opacity-75"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dim)", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div>
            <label htmlFor="action-name" style={labelStyle}>Action name</label>
            <input
              id="action-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={ACTION_NAME_MAX}
              required
              autoFocus
              placeholder="e.g. Renegotiate software contracts"
              style={inputStyle}
            />
          </div>

          {/* Goal type */}
          <div>
            <label htmlFor="action-goal-type" style={labelStyle}>What are you trying to do?</label>
            <select
              id="action-goal-type"
              value={goalType}
              onChange={(e) => handleGoalTypeChange(e.target.value as ActionGoalType | "")}
              required
              style={inputStyle}
            >
              <option value="" disabled>Choose one…</option>
              {GOAL_TYPES.map((t) => (
                <option key={t} value={t}>{GOAL_TYPE_PROMPTS[t]}</option>
              ))}
            </select>
          </div>

          {/* Goal amount + unit — only once a goal type is chosen */}
          {goalType && (
            <div>
              <label htmlFor="action-goal-value" style={labelStyle}>
                Goal amount <span style={{ fontWeight: 300, color: "var(--dim)" }}>(optional)</span>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="action-goal-value"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={goalValue}
                  onChange={(e) => setGoalValue(e.target.value)}
                  placeholder="e.g. 5000"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select
                  aria-label="Goal unit"
                  value={goalUnit}
                  onChange={(e) => setGoalUnit(e.target.value as ActionGoalUnit)}
                  style={{ ...inputStyle, width: 120 }}
                >
                  {GOAL_UNITS.map((u) => (
                    <option key={u} value={u}>{GOAL_UNIT_LABELS[u]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label htmlFor="action-description" style={labelStyle}>
              What does success look like? <span style={{ fontWeight: 300, color: "var(--dim)" }}>(optional)</span>
            </label>
            <textarea
              id="action-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={ACTION_TEXT_MAX}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <p style={hintStyle}>{description.length}/{ACTION_TEXT_MAX}</p>
          </div>

          {/* Due date */}
          <div>
            <label htmlFor="action-due-date" style={labelStyle}>
              Due date <span style={{ fontWeight: 300, color: "var(--dim)" }}>(optional)</span>
            </label>
            <input
              id="action-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ ...inputStyle, width: 200 }}
            />
          </div>

          {/* Edit mode: status */}
          {isEdit && (
            <div>
              <span style={labelStyle}>Status</span>
              <div role="radiogroup" aria-label="Status" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ACTION_STATUSES.map((s) => {
                  const selected = status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setStatus(s)}
                      style={{
                        fontSize: 13,
                        fontWeight: selected ? 500 : 400,
                        color: selected ? "var(--surface)" : "var(--ink)",
                        backgroundColor: selected ? "var(--teal)" : "var(--surface)",
                        border: `1px solid ${selected ? "var(--teal)" : "var(--line)"}`,
                        borderRadius: 999,
                        padding: "6px 14px",
                        cursor: "pointer",
                      }}
                    >
                      {ACTION_STATUS_LABELS[s]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Edit mode: completion details */}
          {isEdit && status === "completed" && (
            <>
              <div>
                <label htmlFor="action-actual-impact" style={labelStyle}>
                  Actual result <span style={{ fontWeight: 300, color: "var(--dim)" }}>(optional)</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="action-actual-impact"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={actualImpact}
                    onChange={(e) => setActualImpact(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {/* goal_unit doubles as the actual-result unit — schema constraint.
                      A dedicated actual_unit column is the right fix in V2. */}
                  <select
                    aria-label="Actual result unit"
                    value={goalUnit}
                    onChange={(e) => setGoalUnit(e.target.value as ActionGoalUnit)}
                    style={{ ...inputStyle, width: 120 }}
                  >
                    {GOAL_UNITS.map((u) => (
                      <option key={u} value={u}>{GOAL_UNIT_LABELS[u]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="action-actual-notes" style={labelStyle}>
                  Notes on what happened <span style={{ fontWeight: 300, color: "var(--dim)" }}>(optional)</span>
                </label>
                <textarea
                  id="action-actual-notes"
                  value={actualNotes}
                  onChange={(e) => setActualNotes(e.target.value)}
                  maxLength={ACTION_TEXT_MAX}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>
            </>
          )}
        </div>

        {error && (
          <p
            role="alert"
            style={{
              marginTop: 16,
              fontSize: 13,
              fontWeight: 400,
              color: "var(--ink)",
              backgroundColor: "rgba(232,69,69,0.06)",
              borderLeft: "3px solid var(--danger)",
              borderRadius: "var(--radius-sm)",
              padding: "10px 14px",
            }}
          >
            {error}
          </p>
        )}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 24 }}>
          <div>
            {isEdit && onDelete && (
              confirmingDelete ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ color: "var(--ink)", fontWeight: 400 }}>Delete this action?</span>
                  <button
                    type="button"
                    onClick={() => onDelete(editAction)}
                    style={{ fontSize: 13, fontWeight: 500, color: "var(--danger)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    style={{ fontSize: 13, fontWeight: 400, color: "var(--dim)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="transition-opacity hover:opacity-75"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 400, color: "var(--dim)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--ink)",
                backgroundColor: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-md)",
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="transition-opacity hover:opacity-90"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--surface)",
                backgroundColor: "var(--teal)",
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "8px 16px",
                cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create action"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
