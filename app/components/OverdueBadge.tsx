/** Scannable "Overdue" marker shown to the left of a red due date. */
export default function OverdueBadge() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--danger)",
        backgroundColor: "rgba(232,69,69,0.08)",
        border: "1px solid var(--danger)",
        borderRadius: "var(--radius-md)",
        padding: "2px 8px",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      Overdue
    </span>
  );
}
