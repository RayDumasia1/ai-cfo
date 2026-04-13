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
        borderRadius: "var(--radius-md)",
        border: `1px solid ${highlight ? "var(--gold)" : "var(--line)"}`,
        boxShadow: "var(--shadow-sm)",
        padding: "1.25rem 1.5rem",
      }}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--dim)" }}
      >
        {label}
      </p>
      <p
        className="mt-3 text-[1.65rem] font-medium leading-none"
        style={{ color: "var(--ink)" }}
      >
        {value}
      </p>
      {subtext && (
        <p
          className="mt-2 text-xs font-light"
          style={{ color: "var(--dim)" }}
        >
          {subtext}
        </p>
      )}
    </div>
  );
}
