"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";

interface Availability {
  available: boolean;
  spots_remaining: number;
  is_sold_out: boolean;
}

export default function FoundingMemberCTA() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    fetch("/api/founding/availability")
      .then((r) => r.json())
      .then((data: Availability) => {
        setAvailability(data);
        setLoadingAvailability(false);
      })
      .catch(() => setLoadingAvailability(false));
  }, []);

  async function handleCheckout() {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey: "founding_member",
          mode: "subscription",
        }),
      });
      const data = await res.json();
      if (data.sold_out) {
        setAvailability((prev) =>
          prev ? { ...prev, is_sold_out: true, spots_remaining: 0 } : prev
        );
        setCheckoutLoading(false);
        return;
      }
      if (data.already_member) {
        console.warn("FoundingMemberCTA: already a member");
        setCheckoutLoading(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutLoading(false);
      }
    } catch {
      setCheckoutLoading(false);
    }
  }

  if (loadingAvailability) {
    return (
      <div
        style={{
          backgroundColor: "#F4F7FA",
          borderRadius: 16,
          padding: 24,
          height: 200,
          animation: "pulse 2s ease-in-out infinite",
        }}
      >
        <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
    );
  }

  if (!availability || availability.is_sold_out) {
    return (
      <div
        style={{
          backgroundColor: "#F4F7FA",
          border: "1px solid #D8E2EC",
          borderRadius: 16,
          padding: 24,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: 11,
            color: "#6B7A8D",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            margin: "0 0 8px",
          }}
        >
          <Star size={16} fill="#D4AF7F" color="#D4AF7F" style={{ verticalAlign: "middle", marginRight: 4 }} /> Founding Member
        </p>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: "#0A1A2F",
            margin: "0 0 8px",
          }}
        >
          All 25 Founding Member spots have been claimed
        </h3>
        <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 20px" }}>
          Join our waitlist to be notified of future offers.
        </p>
        <button
          onClick={() => window.open("https://elidan.ai/waitlist", "_blank")}
          style={{
            backgroundColor: "transparent",
            border: "1.5px solid #2CA6A4",
            color: "#2CA6A4",
            borderRadius: 10,
            height: 40,
            padding: "0 20px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Join the waitlist
        </button>
      </div>
    );
  }

  const spotsText =
    availability.spots_remaining === 1
      ? "1 spot remaining"
      : `${availability.spots_remaining} spots remaining`;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0A1A2F 0%, #1A2E44 100%)",
        border: "1px solid #D4AF7F",
        borderRadius: 16,
        padding: 24,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#D4AF7F",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          margin: "0 0 8px",
        }}
      >
        <Star size={16} fill="#D4AF7F" color="#D4AF7F" style={{ verticalAlign: "middle", marginRight: 4 }} /> Limited Availability
      </p>
      <h3
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: "#FFFFFF",
          margin: "0 0 8px",
        }}
      >
        Founding Member Access
      </h3>
      <p style={{ fontSize: 14, color: "#D4AF7F", margin: "0 0 16px" }}>
        Core features at $49/month — permanently locked as long as you stay subscribed. Only {spotsText}.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
        {[
          "Core features — forever",
          "$49/month — permanently locked",
          "Founding Member badge",
          "Direct roadmap input",
          `${spotsText} of 25`,
        ].map((item) => (
          <div
            key={item}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <CheckCircle2 size={14} color="#2CA6A4" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#FFFFFF" }}>{item}</span>
          </div>
        ))}
      </div>

      <button
        onClick={handleCheckout}
        disabled={checkoutLoading}
        style={{
          width: "100%",
          height: 44,
          backgroundColor: checkoutLoading ? "#C9A070" : "#D4AF7F",
          color: "#0A1A2F",
          border: "none",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 500,
          cursor: checkoutLoading ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {checkoutLoading ? (
          <>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Redirecting to checkout…
          </>
        ) : (
          "Become a Founding Member →"
        )}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </button>

      <p
        style={{
          fontSize: 11,
          color: "#6B7A8D",
          textAlign: "center",
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        Cancel within 30 days of billing end to keep your status
      </p>
    </div>
  );
}
