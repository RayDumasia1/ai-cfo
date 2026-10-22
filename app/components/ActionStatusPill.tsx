import type { ActionStatus } from "@/lib/types";
import { ACTION_STATUS_LABELS } from "@/lib/actions";

const STATUS_PILL: Record<ActionStatus, { color: string; bg: string }> = {
  not_started: { color: "var(--dim)",  bg: "rgba(107,122,141,0.10)" },
  in_progress: { color: "var(--teal)", bg: "rgba(44,166,164,0.10)" },
  completed:   { color: "var(--color-success-text)", bg: "rgba(34,197,94,0.10)" },
};

export default function ActionStatusPill({ status }: { status: ActionStatus }) {
  const s = STATUS_PILL[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: s.color,
        backgroundColor: s.bg,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {ACTION_STATUS_LABELS[status]}
    </span>
  );
}
