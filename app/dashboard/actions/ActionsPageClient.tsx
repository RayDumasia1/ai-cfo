"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { FeatureTier } from "@/lib/featureGates";
import type { Action } from "@/lib/types";
import { GOAL_TYPE_PROMPTS, getActionLimitState } from "@/lib/actions";
import {
  ACTION_EMPTY_MESSAGES,
  ACTION_FILTERS,
  ACTION_FILTER_LABELS,
  filterAndSortActions,
  formatActualImpact,
  formatShortDate,
  formatTimestampDate,
  getTabCounts,
  isOverdue,
  localToday,
  type ActionFilter,
} from "@/lib/actionList";
import ActionModal from "@/app/components/ActionModal";
import ActionStatusPill from "@/app/components/ActionStatusPill";
import OverdueBadge from "@/app/components/OverdueBadge";
import { useActionManager } from "@/app/components/useActionManager";

interface ActionsPageClientProps {
  featureTier: FeatureTier;
  initialActions: Action[];
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
  padding: 24,
};

function AddActionButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="transition-opacity hover:opacity-90"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        fontWeight: 500,
        color: "var(--surface)",
        backgroundColor: "var(--teal)",
        border: "none",
        borderRadius: "var(--radius-md)",
        padding: "8px 14px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap",
      }}
    >
      <Plus size={14} />
      Add action
    </button>
  );
}

function ActionCard({
  action,
  today,
  onEdit,
}: {
  action: Action;
  today: string;
  onEdit: (action: Action) => void;
}) {
  const done = action.status === "completed";
  const overdue = isOverdue(action, today);
  const hasResult = done && (action.actual_impact !== null || action.actual_impact_notes);

  return (
    <button
      type="button"
      onClick={() => onEdit(action)}
      aria-label={`Edit ${action.name}`}
      className="w-full text-left transition-opacity hover:opacity-90"
      style={{ ...cardStyle, display: "flex", alignItems: "flex-start", gap: 16, cursor: "pointer" }}
    >
      <div style={{ paddingTop: 2 }}>
        <ActionStatusPill status={action.status} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: "var(--navy)" }}>{action.name}</p>
        <p style={{ fontSize: 13, fontWeight: 400, color: "var(--dim)", marginTop: 2 }}>
          {GOAL_TYPE_PROMPTS[action.goal_type]}
        </p>
        {hasResult && (
          <p style={{ fontSize: 13, fontWeight: 400, color: "var(--ink)", marginTop: 8 }}>
            {action.actual_impact !== null && (
              <span style={{ fontWeight: 500 }}>
                Result: {formatActualImpact(action.actual_impact, action.goal_unit)}
              </span>
            )}
            {action.actual_impact !== null && action.actual_impact_notes && " · "}
            {action.actual_impact_notes && (
              <span style={{ fontWeight: 300 }}>{action.actual_impact_notes}</span>
            )}
          </p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0, paddingTop: 2 }}>
        {done
          ? action.completed_at && (
              <span style={{ fontSize: 13, fontWeight: 400, color: "var(--dim)" }}>
                Completed {formatTimestampDate(action.completed_at)}
              </span>
            )
          : action.due_date && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {overdue && <OverdueBadge />}
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: overdue ? 500 : 400,
                    color: overdue ? "var(--danger)" : "var(--dim)",
                  }}
                >
                  Due {formatShortDate(action.due_date)}
                </span>
              </span>
            )}
        <Pencil size={16} aria-hidden="true" style={{ color: "var(--dim)" }} />
      </div>
    </button>
  );
}

export default function ActionsPageClient({ featureTier, initialActions }: ActionsPageClientProps) {
  const { actions, actionError, openModal, modalKey, modalProps } = useActionManager(initialActions);
  const [filter, setFilter] = useState<ActionFilter>("all");

  const today = localToday();
  const visible = filterAndSortActions(actions, filter, today);
  const counts = getTabCounts(actions, today);
  const { atLimit } = getActionLimitState(featureTier, counts.active.count);

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div
        className="mb-6"
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}
      >
        <div>
          <h1 className="text-2xl font-medium text-ink">Actions</h1>
          <p className="mt-1 text-sm font-light text-dim">
            Track the steps you&rsquo;re taking to improve your finances
          </p>
        </div>
        <AddActionButton onClick={() => openModal()} disabled={atLimit} />
      </div>

      {atLimit && (
        <p
          className="mb-6"
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: "var(--ink)",
            backgroundColor: "rgba(245,158,11,0.06)",
            borderLeft: "3px solid var(--warning)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
          }}
        >
          You&rsquo;ve reached your plan&rsquo;s active action limit. Complete or delete an action to add another.
        </p>
      )}

      {/* Filter tabs */}
      <div
        role="tablist"
        aria-label="Filter actions"
        className="mb-6"
        style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--line)" }}
      >
        {ACTION_FILTERS.map((f) => {
          const selected = filter === f;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 14,
                fontWeight: selected ? 500 : 400,
                color: selected ? "var(--teal)" : "var(--dim)",
                background: "none",
                border: "none",
                borderBottom: `2px solid ${selected ? "var(--teal)" : "transparent"}`,
                padding: "8px 0",
                marginBottom: -1,
                cursor: "pointer",
              }}
            >
              {ACTION_FILTER_LABELS[f]}
              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 400, color: "var(--dim)" }}>
                ({counts[f].count}
                {counts[f].overdue > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "var(--danger)" }}>{counts[f].overdue} overdue</span>
                  </>
                )}
                )
              </span>
            </button>
          );
        })}
      </div>

      {actionError && (
        <p
          role="alert"
          className="mb-4"
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: "var(--ink)",
            backgroundColor: "rgba(232,69,69,0.06)",
            borderLeft: "3px solid var(--danger)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
          }}
        >
          {actionError}
        </p>
      )}

      {/* List */}
      {visible.length > 0 ? (
        <div role="tabpanel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visible.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              today={today}
              onEdit={(a) => openModal(undefined, a)}
            />
          ))}
        </div>
      ) : (
        <div role="tabpanel" style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 14, fontWeight: 300, color: "var(--ink)" }}>
            {ACTION_EMPTY_MESSAGES[filter]}
          </p>
          {filter === "all" && (
            <div style={{ marginTop: 16 }}>
              <AddActionButton onClick={() => openModal()} disabled={atLimit} />
            </div>
          )}
        </div>
      )}

      <ActionModal key={modalKey} {...modalProps} />
    </div>
  );
}
