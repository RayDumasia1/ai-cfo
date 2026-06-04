"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

interface CheckoutSuccessBannerProps {
  show: boolean;
  message?: string;
}

export default function CheckoutSuccessBanner({ show, message }: CheckoutSuccessBannerProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (!show) return;
    router.replace("/dashboard", { scroll: false });
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [show, router]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      style={{
        backgroundColor: "rgba(44,166,164,0.08)",
        border: "1px solid rgba(44,166,164,0.30)",
        borderLeft: "3px solid #2CA6A4",
        borderRadius: 10,
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CheckCircle2 size={18} color="#2CA6A4" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: "#344150" }}>
          {message ?? "Your plan has been upgraded. Welcome aboard!"}
        </span>
      </div>
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#6B7A8D",
          padding: 4,
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
