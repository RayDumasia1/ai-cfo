type StatCardProps = {
  label: string;
  value: string;
  subtext?: string;
  /** Gold border — use on one card per screen only */
  highlight?: boolean;
};

export default function StatCard({
  label,
  value,
  subtext,
  highlight = false,
}: StatCardProps) {
  return (
    <div
      className="bg-surface flex flex-col"
      style={{
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${highlight ? "var(--gold)" : "var(--line)"}`,
        boxShadow: "var(--shadow-sm)",
        padding: "1.25rem 1.5rem",
        height: "100%",
        minHeight: 120,
        justifyContent: "space-between",
      }}
    >
      <p
        className="text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: "var(--dim)" }}
      >
        {label}
      </p>
      <p
        className="mt-3 font-medium leading-none"
        style={{ color: "var(--ink)", fontSize: 32, letterSpacing: "-1px", whiteSpace: "nowrap" }}
      >
        {value}
      </p>
      {subtext && (
        <p
          className="mt-2 text-xs font-light"
          style={{ color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}
        >
          {subtext}
        </p>
      )}
    </div>
  );
}
