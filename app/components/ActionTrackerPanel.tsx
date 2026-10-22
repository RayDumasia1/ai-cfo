"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, Info, ListChecks, Pencil, Plus } from "lucide-react";
import type { FeatureTier } from "@/lib/featureGates";
import { USAGE_LIMITS } from "@/lib/featureGates";
import type { Action } from "@/lib/types";
import {
  GOAL_TYPE_LABELS,
  getActionLimitState,
  isActiveAction,
} from "@/lib/actions";
import { formatShortDate, isOverdue } from "@/lib/actionList";
import ActionStatusPill from "./ActionStatusPill";

interface ActionTrackerPanelProps {
  featureTier: FeatureTier;
  actions: Action[];
  onAddAction: () => void;
  onEditAction: (action: Action) => void;
  /** Inline error shown after a failed (reverted) optimistic update. */
  errorMessage?: string | null;
}

const TIER_NAMES: Record<FeatureTier, string> = {
  suspended: "Suspended",
  starter: "Starter",
  core: "Core",
  growth: "Growth",
  advisory: "Advisory",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-sm)",
  padding: 24,
  marginTop: 24,
};

/** Copy for the next tier's allowance, e.g. "upgrade to Core for 50". */
function upgradeHint(tier: FeatureTier): string | null {
  if (tier !== "starter") return null;
  const coreLimit = USAGE_LIMITS.core.actions_active;
  return coreLimit === null ? "upgrade to Core for unlimited" : `upgrade to Core for ${coreLimit}`;
}

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

function ActionRow({ action, onEdit }: { action: Action; onEdit: (a: Action) => void }) {
  const overdue = isOverdue(action);
  const done = action.status === "completed";
  return (
    <button
      type="button"
      onClick={() => onEdit(action)}
      className="w-full text-left transition-colors hover:bg-row-alt"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 8px",
        border: "none",
        borderTop: "1px solid var(--line)",
        background: "none",
        cursor: "pointer",
      }}
    >
      <ActionStatusPill status={action.status} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          fontWeight: 400,
          color: done ? "var(--dim)" : "var(--ink)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {action.name}
      </span>
      <span style={{ fontSize: 12, fontWeight: 400, color: "var(--dim)", flexShrink: 0 }}>
        {GOAL_TYPE_LABELS[action.goal_type]}
      </span>
      {action.due_date && (
        <span
          style={{
            fontSize: 12,
            fontWeight: overdue ? 500 : 400,
            color: overdue ? "var(--danger)" : "var(--dim)",
            flexShrink: 0,
            minWidth: 64,
            textAlign: "right",
          }}
        >
          {overdue ? "Overdue · " : "Due "}
          {formatShortDate(action.due_date)}
        </span>
      )}
      <Pencil size={14} aria-label="Edit action" style={{ color: "var(--dim)", flexShrink: 0 }} />
    </button>
  );
}

export default function ActionTrackerPanel({
  featureTier,
  actions,
  onAddAction,
  onEditAction,
  errorMessage,
}: ActionTrackerPanelProps) {
  const [showCompleted, setShowCompleted] = useState(false);

  const active = actions.filter(isActiveAction);
  const completed = actions.filter((a) => !isActiveAction(a));
  const { limit, atLimit, nearLimit } = getActionLimitState(featureTier, active.length);
  const hint = upgradeHint(featureTier);

  const errorStrip = errorMessage && (
    <div
      role="alert"
      style={{
        marginTop: 16,
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: 400,
        color: "var(--ink)",
        backgroundColor: "rgba(232,69,69,0.06)",
        borderLeft: "3px solid var(--danger)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {errorMessage}
    </div>
  );

  // Empty state
  if (actions.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <ListChecks size={18} style={{ color: "var(--teal)" }} />
          <h2 style={{ fontSize: 16, fontWeight: 500, color: "var(--navy)" }}>Action Tracker</h2>
        </div>
        <p style={{ fontSize: 14, fontWeight: 300, color: "var(--ink)", marginBottom: 16 }}>
          Track the steps you&rsquo;re taking to improve your finances.
        </p>
        <AddActionButton onClick={onAddAction} disabled={atLimit} />
        {errorStrip}
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ListChecks size={18} style={{ color: "var(--teal)" }} />
          <h2 style={{ fontSize: 16, fontWeight: 500, color: "var(--navy)" }}>Action Tracker</h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--teal)",
              backgroundColor: "rgba(44,166,164,0.10)",
              border: "1px solid rgba(44,166,164,0.25)",
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            {active.length} active
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link
            href="/dashboard/actions"
            className="transition-opacity hover:opacity-75"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--teal)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            View all
            <ArrowRight size={14} />
          </Link>
          <AddActionButton onClick={onAddAction} disabled={atLimit} />
        </div>
      </div>

      {/* Limit reached — inline, non-blocking */}
      {atLimit && limit !== null && (
        <p
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: "var(--ink)",
            backgroundColor: "rgba(245,158,11,0.06)",
            borderLeft: "3px solid var(--warning)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          You&rsquo;ve reached the {limit} active action limit on {TIER_NAMES[featureTier]}.
          Complete or delete an action to add another{hint ? `, or ${hint}` : ""}.
        </p>
      )}

      {/* Near limit — teal info strip */}
      {nearLimit && limit !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 400,
            color: "var(--ink)",
            backgroundColor: "rgba(44,166,164,0.06)",
            borderLeft: "3px solid var(--teal)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          <Info size={14} style={{ color: "var(--teal)", flexShrink: 0 }} />
          <span>
            {active.length} of {limit} actions used{hint ? ` — ${hint}` : ""}
          </span>
        </div>
      )}

      {/* Active rows */}
      {active.length > 0 ? (
        <div>
          {active.map((action) => (
            <ActionRow key={action.id} action={action} onEdit={onEditAction} />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, fontWeight: 300, color: "var(--dim)", padding: "12px 0" }}>
          No active actions — everything&rsquo;s wrapped up.
        </p>
      )}

      {/* Completed — collapsed by default */}
      {completed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            aria-expanded={showCompleted}
            className="transition-opacity hover:opacity-75"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--dim)",
              background: "none",
              border: "none",
              padding: "8px 0",
              cursor: "pointer",
            }}
          >
            {showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {completed.length} completed
          </button>
          {showCompleted &&
            completed.map((action) => (
              <ActionRow key={action.id} action={action} onEdit={onEditAction} />
            ))}
        </div>
      )}

      {errorStrip}
    </div>
  );
}
