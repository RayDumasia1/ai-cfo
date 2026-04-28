"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { FeatureTier } from "@/lib/featureGates";
import { UPGRADE_MESSAGES } from "@/lib/featureGates";
import UpgradeModal from "./UpgradeModal";

interface UpgradeStripProps {
  currentTier: FeatureTier;
}

export default function UpgradeStrip({ currentTier }: UpgradeStripProps) {
  const [modalOpen, setModalOpen] = useState(false);

  if (currentTier !== "starter") return null;

  return (
    <>
      <div
        style={{
          backgroundColor: "rgba(44,166,164,0.06)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "rgba(44,166,164,0.20)",
          borderLeftWidth: 3,
          borderLeftColor: "#2CA6A4",
          borderRadius: 10,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={16} color="#2CA6A4" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "#344150" }}>
            Unlock AI Insights, Ask your CFO, and QuickBooks sync
          </span>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            background: "none",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            color: "#2CA6A4",
            cursor: "pointer",
            textDecoration: "none",
            whiteSpace: "nowrap",
            marginLeft: 16,
            padding: 0,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.textDecoration = "underline")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.textDecoration = "none")
          }
        >
          Upgrade to Core →
        </button>
      </div>

      <UpgradeModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        feature="ask_cfo"
        currentTier={currentTier}
        upgradeMessage={UPGRADE_MESSAGES["ask_cfo"]}
      />
    </>
  );
}
