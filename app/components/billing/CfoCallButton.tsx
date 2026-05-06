"use client";

import { useState } from "react";
import { Phone, Lock, Loader2 } from "lucide-react";
import type { FeatureTier } from "@/lib/featureGates";
import { UPGRADE_MESSAGES } from "@/lib/featureGates";
import UpgradeModal from "@/app/components/billing/UpgradeModal";

interface CfoCallButtonProps {
  userTier: FeatureTier;
  userEmail: string;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};

export default function CfoCallButton({ userTier, userEmail }: CfoCallButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleBook() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey: "cfo_call", mode: "payment" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setLoading(false);
    }
  }

  // Starter: locked — opens UpgradeModal to prompt upgrade
  if (userTier === "starter") {
    return (
      <section style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#0A1A2F", margin: "0 0 4px" }}>
          CFO Call
        </h2>
        <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 16px" }}>
          Book a one-on-one session with a certified financial advisor.
        </p>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 44,
            padding: "0 20px",
            backgroundColor: "#F4F7FA",
            border: "1px dashed #D8E2EC",
            borderRadius: 10,
            fontSize: 14,
            color: "#6B7A8D",
            cursor: "not-allowed",
          }}
        >
          <Lock size={14} color="#6B7A8D" />
          Book a CFO Call
        </button>
        <UpgradeModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          feature="cfo_call"
          currentTier={userTier}
          upgradeMessage={UPGRADE_MESSAGES["cfo_call"]}
        />
      </section>
    );
  }

  // Advisory: free monthly call via Calendly
  if (userTier === "advisory") {
    return (
      <section style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#0A1A2F", margin: "0 0 4px" }}>
          CFO Call
        </h2>
        <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 16px" }}>
          Your Advisory plan includes a monthly CFO call. Book your session below.
        </p>
        <a
          href={process.env.NEXT_PUBLIC_CALENDLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 44,
            padding: "0 20px",
            backgroundColor: "#2CA6A4",
            border: "none",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            color: "#FFFFFF",
            textDecoration: "none",
          }}
        >
          <Phone size={14} />
          Book your monthly CFO call
        </a>
      </section>
    );
  }

  // Core / Growth: paid one-time call ($150)
  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: "#0A1A2F", margin: "0 0 4px" }}>
        CFO Call
      </h2>
      <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 16px" }}>
        Book a 60-minute strategy session with a certified financial advisor for $150.
        Your advisor reviews your Elidan dashboard before the call.
      </p>
      <button
        onClick={handleBook}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 44,
          padding: "0 20px",
          backgroundColor: loading ? "#6B7A8D" : "#0A1A2F",
          border: "none",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 500,
          color: "#FFFFFF",
          cursor: loading ? "not-allowed" : "pointer",
        }}
        onMouseEnter={(e) => {
          if (!loading)
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1A2E44";
        }}
        onMouseLeave={(e) => {
          if (!loading)
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0A1A2F";
        }}
      >
        {loading ? (
          <>
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
            Redirecting...
          </>
        ) : (
          <>
            <Phone size={14} />
            Book a CFO Call · $150
          </>
        )}
      </button>
      {error && (
        <p style={{ fontSize: 13, color: "#DC2626", marginTop: 8, marginBottom: 0 }}>
          {error}
        </p>
      )}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}
