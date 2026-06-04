"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface FoundingMemberGraceBannerProps {
  memberNumber: number;
  graceEndsAt: string;
  billingPeriodEnd: string;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );
}

export default function FoundingMemberGraceBanner({
  memberNumber,
  graceEndsAt,
  billingPeriodEnd,
}: FoundingMemberGraceBannerProps) {
  const [loading, setLoading] = useState(false);

  if (new Date(graceEndsAt) <= new Date()) return null;

  const daysRemaining = daysUntil(graceEndsAt);

  async function handleResubscribe() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey: "founding_member",
          mode: "subscription",
          isFoundingMemberRestore: true,
          originalMemberNumber: memberNumber,
        }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      setLoading(false);
    }
  }

  return (
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
        marginBottom: 16,
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
            Your Founding Member subscription has been cancelled
          </p>
          <p style={{ fontSize: 12, color: "#6B7A8D", margin: 0 }}>
            Core features active until {formatDateShort(billingPeriodEnd)} ·
            Grace period ends {formatDateShort(graceEndsAt)} ({daysRemaining} days remaining) ·
            After this date, your status is irreversibly lost
          </p>
        </div>
      </div>
      <button
        onClick={handleResubscribe}
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
          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          "Resubscribe →"
        )}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </button>
    </div>
  );
}
