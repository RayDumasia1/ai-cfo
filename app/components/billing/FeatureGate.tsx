"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { hasFeature, UPGRADE_MESSAGES } from "@/lib/featureGates";
import type { Feature, FeatureTier } from "@/lib/featureGates";
import UpgradeModal from "./UpgradeModal";

interface FeatureGateProps {
  feature: Feature;
  userTier: FeatureTier;
  userEmail?: string;
  children: React.ReactNode;
  lockBehaviour: "hide" | "blur" | "replace";
  replacementContent?: React.ReactNode;
}

function capitaliseTier(tier: FeatureTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function FeatureGate({
  feature,
  userTier,
  userEmail,
  children,
  lockBehaviour,
  replacementContent,
}: FeatureGateProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const canAccess = hasFeature(userTier, feature, userEmail);
  const upgradeMessage = UPGRADE_MESSAGES[feature];

  if (canAccess) return <>{children}</>;

  if (lockBehaviour === "hide") return null;

  const modal = (
    <UpgradeModal
      isOpen={modalOpen}
      onClose={() => setModalOpen(false)}
      feature={feature}
      currentTier={userTier}
      upgradeMessage={upgradeMessage}
    />
  );

  if (lockBehaviour === "replace") {
    return (
      <>
        {replacementContent ? (
          <div
            onClick={() => setModalOpen(true)}
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setModalOpen(true)}
          >
            {replacementContent}
          </div>
        ) : (
          <button
            onClick={() => setModalOpen(true)}
            style={{
              width: "100%",
              height: 44,
              backgroundColor: "#F4F7FA",
              border: "1px dashed #D8E2EC",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <Lock size={16} color="#6B7A8D" />
            <span style={{ fontSize: 13, color: "#6B7A8D" }}>
              Upgrade to {capitaliseTier(upgradeMessage.upgrade_to)}
            </span>
          </button>
        )}
        {modal}
      </>
    );
  }

  // blur behaviour
  return (
    <>
      <div style={{ position: "relative" }}>
        <div
          style={{
            filter: "blur(4px)",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {children}
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Lock size={20} color="#6B7A8D" />
          <span style={{ fontSize: 13, color: "#6B7A8D" }}>
            Available on {capitaliseTier(upgradeMessage.upgrade_to)}
          </span>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              background: "none",
              border: "none",
              fontSize: 13,
              color: "#2CA6A4",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Upgrade
          </button>
        </div>
      </div>
      {modal}
    </>
  );
}
