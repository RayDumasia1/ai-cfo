"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface FoundingMemberWelcomeBannerProps {
  memberNumber: number;
  userId: string;
}

export default function FoundingMemberWelcomeBanner({
  memberNumber,
  userId,
}: FoundingMemberWelcomeBannerProps) {
  const storageKey = `elidan_fm_banner_dismissed_${userId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(storageKey);
    if (dismissed !== "true") {
      setVisible(true);
    }
  }, [storageKey]);

  function dismiss() {
    localStorage.setItem(storageKey, "true");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0A1A2F 0%, #1A2E44 100%)",
        borderBottom: "2px solid #D4AF7F",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20, color: "#D4AF7F", flexShrink: 0 }}>✦</span>
        <div>
          <p
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#FFFFFF",
              margin: "0 0 2px",
            }}
          >
            Welcome, Founding Member #{memberNumber}
          </p>
          <p style={{ fontSize: 12, color: "#D4AF7F", margin: 0 }}>
            Core features are active. Your $49/month rate is locked permanently — forever.
          </p>
        </div>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#D4AF7F",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
