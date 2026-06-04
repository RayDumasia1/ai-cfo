"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface SuspendedRestoreButtonProps {
  memberNumber: number;
}

export default function SuspendedRestoreButton({
  memberNumber,
}: SuspendedRestoreButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleRestore() {
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
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRestore}
      disabled={loading}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        maxWidth: 320,
        height: 48,
        backgroundColor: loading ? "#C9A070" : "#D4AF7F",
        color: "#0A1A2F",
        border: "none",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 500,
        cursor: loading ? "default" : "pointer",
        margin: "24px auto 0",
      }}
    >
      {loading ? (
        <>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          Redirecting...
        </>
      ) : (
        "Restore my Founding Member access"
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
