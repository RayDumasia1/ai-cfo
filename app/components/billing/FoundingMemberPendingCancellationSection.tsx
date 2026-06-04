"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface FoundingMemberPendingCancellationSectionProps {
  memberNumber: number;
  billingPeriodEnd: string;
  graceEndsAt: string;
}

const DISMISS_KEY = "elidan_cancellation_acknowledged";

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function FoundingMemberPendingCancellationSection({
  memberNumber,
  billingPeriodEnd,
  graceEndsAt,
}: FoundingMemberPendingCancellationSectionProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(DISMISS_KEY) === "true";
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReactivate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/reactivate", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        localStorage.removeItem(DISMISS_KEY);
        router.refresh();
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          backgroundColor: "rgba(245,158,11,0.06)",
          borderLeft: "3px solid #F59E0B",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 12,
        }}
      >
        <p style={{ fontSize: 13, color: "#344150", margin: 0 }}>
          Your subscription is scheduled to cancel on{" "}
          <strong>{formatDateShort(billingPeriodEnd)}</strong>. You&apos;ll
          have until <strong>{formatDateShort(graceEndsAt)}</strong> to restore
          your Founding Member #{memberNumber} status.
        </p>
      </div>

      <button
        onClick={handleReactivate}
        disabled={loading}
        style={{
          width: "100%",
          height: 40,
          backgroundColor: loading ? "#6B7A8D" : "#2CA6A4",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        {loading && (
          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
        )}
        {loading ? "Restoring access..." : "Keep my Founding Member access"}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </button>

      <button
        onClick={handleDismiss}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          fontSize: 12,
          color: "#6B7A8D",
          cursor: "pointer",
          padding: "6px 0",
        }}
      >
        I understand, cancel anyway
      </button>

      {error && (
        <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4, marginBottom: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
