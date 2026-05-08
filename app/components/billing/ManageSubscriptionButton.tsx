"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface ManageSubscriptionButtonProps {
  customerId: string | null;
}

export default function ManageSubscriptionButton({
  customerId,
}: ManageSubscriptionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!customerId) return null;

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not open billing portal");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 16px",
          fontSize: 13,
          fontWeight: 500,
          color: loading ? "#6B7A8D" : "#0A1A2F",
          background: "#FFFFFF",
          border: "1px solid #D8E2EC",
          borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading && (
          <Loader2
            size={14}
            style={{ animation: "spin 1s linear infinite" }}
          />
        )}
        {loading ? "Opening portal..." : "Manage subscription →"}
      </button>
      {error && (
        <p style={{ fontSize: 12, color: "#C0392B", marginTop: 6 }}>{error}</p>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
