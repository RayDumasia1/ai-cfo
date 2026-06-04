"use client";

import { AlertTriangle } from "lucide-react";

interface FoundingMemberCancelWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  memberNumber: number;
  billingPeriodEnd: string;
  graceEndDate: string;
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function FoundingMemberCancelWarning({
  isOpen,
  onClose,
  onContinue,
  memberNumber,
  billingPeriodEnd,
  graceEndDate,
}: FoundingMemberCancelWarningProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10,26,47,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          padding: 32,
          width: "100%",
          maxWidth: 480,
          boxShadow: "0 8px 32px rgba(10,26,47,0.20)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <AlertTriangle size={32} color="#F59E0B" style={{ margin: "0 auto 12px" }} />
          <h2
            style={{
              fontSize: 20,
              fontWeight: 500,
              color: "#0A1A2F",
              margin: "0 0 8px",
            }}
          >
            Before you cancel
          </h2>
          <p style={{ fontSize: 14, color: "#6B7A8D", margin: 0 }}>
            You&apos;re Founding Member #{memberNumber} — one of our first{" "}
            {memberNumber} members.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.30)",
            borderLeft: "3px solid #F59E0B",
            borderRadius: 10,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#344150",
              margin: "0 0 10px",
            }}
          >
            If you cancel today:
          </p>
          <ul style={{ margin: 0, paddingLeft: 16, listStyle: "disc" }}>
            {[
              `Core features stay active until ${formatDateLong(billingPeriodEnd)} — you've paid for this period`,
              `After ${formatDateLong(billingPeriodEnd)} your account will be suspended`,
              `You have 30 days from ${formatDateLong(billingPeriodEnd)} to resubscribe and permanently restore your Founding Member #${memberNumber} status (grace period ends: ${formatDateLong(graceEndDate)})`,
              `After ${formatDateLong(graceEndDate)}, your Founding Member #${memberNumber} status is permanently and irreversibly lost — all 50 spots are claimed and none return to the pool`,
            ].map((item) => (
              <li
                key={item}
                style={{ fontSize: 13, color: "#344150", marginBottom: 6 }}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            height: 44,
            backgroundColor: "#2CA6A4",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          Keep my membership
        </button>
        <button
          onClick={onContinue}
          style={{
            width: "100%",
            height: 40,
            backgroundColor: "transparent",
            color: "#6B7A8D",
            border: "none",
            borderRadius: 10,
            fontSize: 13,
            cursor: "pointer",
            padding: 10,
          }}
        >
          Continue to cancel
        </button>
      </div>
    </div>
  );
}
