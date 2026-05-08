"use client";

import { useState } from "react";
import UpgradeModal from "./UpgradeModal";
import { UPGRADE_MESSAGES } from "@/lib/featureGates";

export default function UpgradePromptButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "9px 16px",
          fontSize: 13,
          fontWeight: 500,
          color: "#FFFFFF",
          background: "#2CA6A4",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Upgrade plan →
      </button>
      <UpgradeModal
        isOpen={open}
        onClose={() => setOpen(false)}
        feature="ask_cfo"
        currentTier="starter"
        upgradeMessage={UPGRADE_MESSAGES["ask_cfo"]}
      />
    </>
  );
}
