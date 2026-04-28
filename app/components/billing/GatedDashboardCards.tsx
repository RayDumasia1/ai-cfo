"use client";

import { useState } from "react";
import { Sparkles, MessageSquare } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import FeatureGate from "./FeatureGate";

interface GatedDashboardCardsProps {
  userEmail: string;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  textAlign: "center",
  transition: "border-color 150ms ease, box-shadow 150ms ease",
};

const cardHoverStyle: React.CSSProperties = {
  borderColor: "#2CA6A4",
  boxShadow: "0 2px 8px rgba(44,166,164,0.15)",
};

function AIInsightsPlaceholderCard() {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ ...cardStyle, ...(hovered ? cardHoverStyle : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Sparkles size={24} color={hovered ? "#2CA6A4" : "#D8E2EC"} style={{ transition: "color 150ms ease" }} />
      <p style={{ fontSize: 14, fontWeight: 500, color: "#0A1A2F", margin: 0 }}>
        AI Insights
      </p>
      <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0, maxWidth: 220 }}>
        AI-powered observations about your financial trends.
      </p>
      <span
        style={{
          fontSize: 12,
          color: "#6B7A8D",
          backgroundColor: "#F4F7FA",
          border: "1px solid #D8E2EC",
          borderRadius: 6,
          padding: "3px 10px",
          marginTop: 4,
        }}
      >
        Available on Core
      </span>
    </div>
  );
}

function AskCFOPlaceholderCard() {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ ...cardStyle, ...(hovered ? cardHoverStyle : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <MessageSquare size={24} color={hovered ? "#2CA6A4" : "#D8E2EC"} style={{ transition: "color 150ms ease" }} />
      <p style={{ fontSize: 14, fontWeight: 500, color: "#0A1A2F", margin: 0 }}>
        Ask your CFO
      </p>
      <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0, maxWidth: 220 }}>
        Ask financial questions in plain English. Get answers grounded in your
        real data.
      </p>
      <span
        style={{
          fontSize: 12,
          color: "#6B7A8D",
          backgroundColor: "#F4F7FA",
          border: "1px solid #D8E2EC",
          borderRadius: 6,
          padding: "3px 10px",
          marginTop: 4,
        }}
      >
        Available on Core
      </span>
    </div>
  );
}

export default function GatedDashboardCards({
  userEmail,
}: GatedDashboardCardsProps) {
  const { subscription, loading } = useSubscription();

  if (loading || !subscription) return <><div /><div /></>;

  return (
    <>
      <FeatureGate
        feature="ai_insights"
        userTier={subscription.feature_tier}
        userEmail={userEmail}
        lockBehaviour="replace"
        replacementContent={<AIInsightsPlaceholderCard />}
      >
        {null}
      </FeatureGate>
      <FeatureGate
        feature="ask_cfo"
        userTier={subscription.feature_tier}
        userEmail={userEmail}
        lockBehaviour="replace"
        replacementContent={<AskCFOPlaceholderCard />}
      >
        {null}
      </FeatureGate>
    </>
  );
}
