"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface PendingCancellationBannerProps {
  memberNumber: number;
  billingPeriodEnd: string;
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function PendingCancellationBanner({
  memberNumber,
  billingPeriodEnd,
}: PendingCancellationBannerProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReactivate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/reactivate", { method: "POST" });
      const data = await res.json();
      if (data.success) {
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

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          backgroundColor: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.30)",
          borderLeft: "3px solid #F59E0B",
          borderRadius: 10,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <AlertTriangle
            size={16}
            color="#F59E0B"
            style={{ flexShrink: 0, marginTop: 2 }}
          />
          <div>
            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#344150",
                margin: "0 0 2px",
              }}
            >
              Your subscription is cancelled
            </p>
            <p style={{ fontSize: 12, color: "#6B7A8D", margin: 0 }}>
              Access continues until {formatDateLong(billingPeriodEnd)}. Changed your mind?
            </p>
          </div>
        </div>
        <button
          onClick={handleReactivate}
          disabled={loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            backgroundColor: "#F59E0B",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: loading ? "default" : "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {loading ? (
            <>
              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              Restoring access...
            </>
          ) : (
            "Undo cancellation →"
          )}
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "#DC2626", marginTop: 6, marginBottom: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
