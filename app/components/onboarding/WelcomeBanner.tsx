"use client";

interface WelcomeBannerProps {
  businessName: string | null;
  onGetStarted: () => void;
  onDismiss: () => void;
}

const FEATURE_PILLS = ["📊 Cash position", "🔥 Burn rate", "⏱ Runway"];

/** Single-colour Rising Column mark (inherits `color`). */
function RisingColumnMark() {
  return (
    <svg viewBox="0 0 38 52" height={80} fill="currentColor" aria-hidden="true">
      <rect x="0" y="24" width="10" height="28" rx="2" />
      <rect x="14" y="12" width="10" height="40" rx="2" />
      <rect x="28" y="0" width="10" height="52" rx="2" />
    </svg>
  );
}

export default function WelcomeBanner({
  businessName,
  onGetStarted,
  onDismiss,
}: WelcomeBannerProps) {
  const title = businessName
    ? `Let's set up ${businessName}'s financial dashboard.`
    : "Let's set up your financial dashboard.";

  return (
    <section
      aria-label="Welcome to Elidan"
      className="mb-6 flex items-center justify-between gap-6 p-8"
      style={{
        background: "linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)",
        border: "1px solid rgba(44,166,164,0.20)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-teal">
          Welcome to Elidan
        </p>
        <h2 className="text-[22px] font-medium leading-[1.3] text-white">{title}</h2>
        <p className="mt-2 text-sm font-normal leading-[1.6] text-on-navy-dim">
          Import your data and see your cash position, burn rate, and runway in
          real time. Takes about 15 minutes.
        </p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {FEATURE_PILLS.map((pill) => (
            <li
              key={pill}
              className="rounded-[20px] border border-white/12 bg-white/8 px-3 py-1 text-xs text-white"
            >
              {pill}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onGetStarted}
            className="h-11 bg-teal px-6 text-sm font-medium text-white transition-colors hover:bg-teal-light"
            style={{ borderRadius: "var(--radius-md)" }}
          >
            Get started →
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer border-none bg-transparent text-[13px] text-on-navy-dim transition-colors hover:text-white"
          >
            I&apos;ll explore first
          </button>
        </div>
      </div>

      <div className="hidden shrink-0 text-teal opacity-[0.12] sm:block">
        <RisingColumnMark />
      </div>
    </section>
  );
}
