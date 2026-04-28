"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  ChevronRight,
  CheckCircle2,
  Lock,
  MessageSquare,
  Sparkles,
  TrendingUp,
  RefreshCw,
  GitCompare,
  Mail,
  Zap,
  Users,
  Phone,
  FileText,
  Building2,
} from "lucide-react";
import type { Feature, FeatureTier } from "@/lib/featureGates";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: Feature;
  currentTier: FeatureTier;
  upgradeMessage: {
    title: string;
    message: string;
    upgrade_to: FeatureTier;
  };
}

const FEATURE_ICONS: Record<Feature, React.ElementType> = {
  ask_cfo: MessageSquare,
  ai_insights: Sparkles,
  weekly_summary: Mail,
  quickbooks_sync: RefreshCw,
  xero_sync: RefreshCw,
  forecasting: TrendingUp,
  scenario_comparison: GitCompare,
  action_tracker_v2: Zap,
  action_tracker_v3: Users,
  team_seats: Users,
  cfo_call: Phone,
  custom_reports: FileText,
  bank_sync: Building2,
};

const TIER_HIGHLIGHTS: Record<FeatureTier, string[]> = {
  starter: [],
  core: [
    "Ask your CFO financial questions with AI",
    "Connect QuickBooks or Xero automatically",
    "Weekly CFO email summary",
  ],
  growth: [
    "Unlimited AI insights and Ask CFO",
    "12-month cash flow forecasting",
    "Side-by-side scenario comparison",
  ],
  advisory: [
    "Monthly 60-minute CFO strategy call",
    "Team seats (up to 3 users)",
    "Board-ready custom reports",
  ],
};

function capitaliseTier(tier: FeatureTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function UpgradeModal({
  isOpen,
  onClose,
  feature,
  currentTier,
  upgradeMessage,
}: UpgradeModalProps) {
  const router = useRouter();
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const Icon = FEATURE_ICONS[feature] ?? Lock;
  const highlights = TIER_HIGHLIGHTS[upgradeMessage.upgrade_to] ?? [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10,26,47,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: prefersReducedMotion.current
          ? undefined
          : "upgradeModalFadeIn 200ms ease-out",
      }}
    >
      <style>{`
        @keyframes upgradeModalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          maxWidth: 480,
          width: "90vw",
          padding: 32,
          boxShadow: "0 8px 32px rgba(10,26,47,0.12)",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#6B7A8D",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
            borderRadius: 6,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#344150")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#6B7A8D")
          }
        >
          <X size={18} />
        </button>

        {/* Icon block */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              backgroundColor: "rgba(44,166,164,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={24} color="#2CA6A4" />
          </div>
        </div>

        {/* Title */}
        <p
          style={{
            fontSize: 20,
            fontWeight: 500,
            color: "#0A1A2F",
            textAlign: "center",
            marginTop: 16,
            marginBottom: 0,
          }}
        >
          {upgradeMessage.title}
        </p>

        {/* Message */}
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            color: "#6B7A8D",
            textAlign: "center",
            lineHeight: 1.6,
            marginTop: 8,
            marginBottom: 0,
            maxWidth: 340,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {upgradeMessage.message}
        </p>

        {/* Tier comparison strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            backgroundColor: "#F4F7FA",
            borderRadius: 10,
            padding: "12px 16px",
            marginTop: 24,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#344150",
              backgroundColor: "#FFFFFF",
              border: "1px solid #D8E2EC",
              borderRadius: 6,
              padding: "4px 10px",
            }}
          >
            Your plan: {capitaliseTier(currentTier)}
          </span>
          <ChevronRight size={16} color="#6B7A8D" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#FFFFFF",
              backgroundColor: "#2CA6A4",
              borderRadius: 6,
              padding: "4px 10px",
            }}
          >
            {capitaliseTier(upgradeMessage.upgrade_to)}
          </span>
        </div>

        {/* Feature highlights */}
        {highlights.length > 0 && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {highlights.map((text) => (
              <div
                key={text}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <CheckCircle2 size={14} color="#2CA6A4" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#344150" }}>{text}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA button */}
        <button
          onClick={() => router.push("/dashboard/settings?tab=billing")}
          style={{
            width: "100%",
            height: 44,
            backgroundColor: "#2CA6A4",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            marginTop: 24,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "#3DBFBD")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "#2CA6A4")
          }
        >
          Upgrade to {capitaliseTier(upgradeMessage.upgrade_to)}
        </button>

        {/* Maybe later */}
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 13,
              color: "#6B7A8D",
              cursor: "pointer",
              textDecoration: "none",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.textDecoration =
                "underline")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.textDecoration =
                "none")
            }
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
