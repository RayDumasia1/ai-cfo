"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import FoundingMemberCancelWarning from "./FoundingMemberCancelWarning";

interface FoundingMemberManageButtonProps {
  customerId: string;
  billingPeriodEnd: string;
  memberNumber: number;
}

export default function FoundingMemberManageButton({
  billingPeriodEnd,
  memberNumber,
}: FoundingMemberManageButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    setModalOpen(false);
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      // silent — portal URL unavailable
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          backgroundColor: "transparent",
          color: "#344150",
          border: "1.5px solid #D8E2EC",
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 500,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? (
          <>
            <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
            Opening portal…
          </>
        ) : (
          "Manage subscription"
        )}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </button>

      <FoundingMemberCancelWarning
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onContinue={handleContinue}
        memberNumber={memberNumber}
        billingPeriodEnd={billingPeriodEnd}
      />
    </>
  );
}
