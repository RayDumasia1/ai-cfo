import type { BillingDetails } from "@/lib/db";
import type { Plan } from "@/lib/featureGates";
import ManageSubscriptionButton from "./ManageSubscriptionButton";
import UpgradePromptButton from "./UpgradePromptButton";

const PLAN_DISPLAY: Record<Plan, string> = {
  starter: "Starter",
  core: "Core",
  growth: "Growth",
  advisory: "Advisory",
  founding_member: "Founding Member",
};

const PLAN_PRICES: Record<Plan, string> = {
  starter: "$49 / month",
  core: "$99 / month",
  growth: "$199 / month",
  advisory: "$499 / month",
  founding_member: "Founding Member rate",
};

const PLAN_BADGE_COLORS: Record<Plan, { bg: string; color: string }> = {
  starter: { bg: "#F4F7FA", color: "#6B7A8D" },
  core: { bg: "rgba(44,166,164,0.10)", color: "#2CA6A4" },
  growth: { bg: "rgba(44,166,164,0.15)", color: "#1D8A88" },
  advisory: { bg: "rgba(10,26,47,0.08)", color: "#0A1A2F" },
  founding_member: { bg: "rgba(44,166,164,0.10)", color: "#2CA6A4" },
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: "rgba(44,166,164,0.10)", color: "#2CA6A4", label: "Active" },
  past_due: { bg: "rgba(217,119,6,0.10)", color: "#B45309", label: "Past due" },
  cancelled: { bg: "rgba(220,38,38,0.10)", color: "#DC2626", label: "Cancelled" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface CurrentPlanCardProps {
  billing: BillingDetails;
}

export default function CurrentPlanCard({ billing }: CurrentPlanCardProps) {
  const planBadge = PLAN_BADGE_COLORS[billing.plan] ?? PLAN_BADGE_COLORS.starter;
  const statusInfo = STATUS_BADGE[billing.status] ?? STATUS_BADGE.active;

  let renewalLine: string;
  if (billing.status === "cancelled" && billing.billing_period_end) {
    renewalLine = `Cancelled · access until ${formatDate(billing.billing_period_end)}`;
  } else if (billing.billing_period_end && billing.status !== "cancelled") {
    renewalLine = `Renews on ${formatDate(billing.billing_period_end)}`;
  } else if (billing.billing_period_end) {
    renewalLine = `Renews on ${formatDate(billing.billing_period_end)}`;
  } else {
    renewalLine = "—";
  }

  return (
    <section
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #D8E2EC",
        borderRadius: 16,
        boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
        padding: 24,
      }}
    >
      {billing.status === "past_due" && (
        <div
          style={{
            backgroundColor: "rgba(217,119,6,0.08)",
            border: "1px solid rgba(217,119,6,0.25)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "#92400E",
            fontWeight: 500,
          }}
        >
          Payment failed — please update your payment method below.
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
            backgroundColor: planBadge.bg,
            color: planBadge.color,
          }}
        >
          {PLAN_DISPLAY[billing.plan]}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 500,
            backgroundColor: statusInfo.bg,
            color: statusInfo.color,
          }}
        >
          {statusInfo.label}
        </span>
      </div>

      <p
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "#0A1A2F",
          margin: "0 0 4px",
        }}
      >
        {PLAN_PRICES[billing.plan]}
      </p>
      <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 20px" }}>
        {renewalLine}
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {billing.stripe_customer_id ? (
          <ManageSubscriptionButton customerId={billing.stripe_customer_id} />
        ) : (
          <UpgradePromptButton />
        )}
      </div>
    </section>
  );
}
