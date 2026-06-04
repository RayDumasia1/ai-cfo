import type { BillingDetails } from "@/lib/db";
import type { Plan } from "@/lib/featureGates";
import ManageSubscriptionButton from "./ManageSubscriptionButton";
import UpgradePromptButton from "./UpgradePromptButton";
import FoundingMemberBadge from "./FoundingMemberBadge";
import FoundingMemberManageButton from "./FoundingMemberManageButton";
import FoundingMemberPendingCancellationSection from "./FoundingMemberPendingCancellationSection";

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
  founding_member: "$49 / month",
};

const PLAN_BADGE_COLORS: Record<Plan, { bg: string; color: string }> = {
  starter: { bg: "#F4F7FA", color: "#6B7A8D" },
  core: { bg: "rgba(44,166,164,0.10)", color: "#2CA6A4" },
  growth: { bg: "rgba(44,166,164,0.15)", color: "#1D8A88" },
  advisory: { bg: "rgba(10,26,47,0.08)", color: "#0A1A2F" },
  founding_member: { bg: "#FBF5EC", color: "#7D4E00" },
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: "rgba(44,166,164,0.10)", color: "#2CA6A4", label: "Active" },
  past_due: { bg: "rgba(217,119,6,0.10)", color: "#B45309", label: "Past due" },
  cancelled: { bg: "rgba(220,38,38,0.10)", color: "#DC2626", label: "Cancelled" },
  pending_cancellation: { bg: "rgba(245,158,11,0.10)", color: "#7D4E00", label: "" },
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
  } else if (billing.status === "pending_cancellation" && billing.billing_period_end) {
    renewalLine = `Cancels on ${formatDate(billing.billing_period_end)}`;
  } else if (billing.billing_period_end) {
    renewalLine = `Renews on ${formatDate(billing.billing_period_end)}`;
  } else {
    renewalLine = "—";
  }

  const isPendingCancellationFM =
    billing.plan === "founding_member" && billing.status === "pending_cancellation";
  const isActiveFoundingMember =
    billing.plan === "founding_member" && billing.status === "active";

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
        {isPendingCancellationFM && billing.billing_period_end ? (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              backgroundColor: "rgba(245,158,11,0.10)",
              border: "1px solid #F59E0B",
              color: "#7D4E00",
            }}
          >
            Cancels {new Date(billing.billing_period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        ) : (
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
        )}
      </div>

      {/* Founding member badge */}
      {billing.plan === "founding_member" && (
        <div style={{ marginBottom: 12 }}>
          <FoundingMemberBadge
            memberNumber={billing.founding_member_number}
            featureTier={billing.feature_tier}
          />
        </div>
      )}

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

      {isPendingCancellationFM &&
        billing.billing_period_end &&
        billing.founding_member_grace_ends_at ? (
        <FoundingMemberPendingCancellationSection
          memberNumber={billing.founding_member_number ?? 1}
          billingPeriodEnd={billing.billing_period_end}
          graceEndsAt={billing.founding_member_grace_ends_at}
        />
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {isActiveFoundingMember && billing.billing_period_end ? (
            <FoundingMemberManageButton
              customerId={billing.stripe_customer_id ?? ""}
              billingPeriodEnd={billing.billing_period_end}
              memberNumber={billing.founding_member_number ?? 1}
            />
          ) : billing.stripe_customer_id ? (
            <ManageSubscriptionButton customerId={billing.stripe_customer_id} />
          ) : (
            <UpgradePromptButton />
          )}
        </div>
      )}
    </section>
  );
}
