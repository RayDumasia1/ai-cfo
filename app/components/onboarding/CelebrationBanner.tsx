"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, X } from "lucide-react";

interface CelebrationBannerProps {
  businessName: string | null;
  /** Runway in months from the freshly imported data; null when not computable. */
  currentRunway: number | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;

function runwayMessage(runway: number | null): { text: string; color: string } {
  if (runway == null) {
    return {
      text: "Your financial data has been imported. Take a look at what we found.",
      color: "var(--on-navy-dim)",
    };
  }
  if (runway < 3) {
    return {
      text: "We've spotted some urgent items that need your attention. Check the alerts below.",
      color: "var(--warning)",
    };
  }
  if (runway <= 6) {
    return {
      text: "Your finances are manageable but there are a few things to watch. Check the alerts.",
      color: "var(--on-navy-dim)",
    };
  }
  return {
    text: "Your finances are in good shape. Here's what we found.",
    color: "var(--teal)",
  };
}

export default function CelebrationBanner({
  businessName,
  currentRunway,
  onDismiss,
}: CelebrationBannerProps) {
  // Keep the latest callback without restarting the timer on re-render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    const t = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, []);

  const title = businessName
    ? `${businessName}'s dashboard is live! 🎉`
    : "Your dashboard is live! 🎉";
  const message = runwayMessage(currentRunway);

  return (
    <section
      role="status"
      aria-label="Onboarding complete"
      className="relative mb-6 p-8"
      style={{
        background: "linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)",
        border: "1px solid rgba(44,166,164,0.30)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-4 top-4 text-on-navy-dim transition-colors hover:text-white"
      >
        <X size={18} />
      </button>

      <div className="flex items-center gap-3 pr-8">
        <CheckCircle2 size={24} className="shrink-0 text-success" />
        <h2 className="text-xl font-medium text-white">{title}</h2>
      </div>
      <p className="mt-2 text-sm leading-[1.6]" style={{ color: message.color }}>
        {message.text}
      </p>
    </section>
  );
}
