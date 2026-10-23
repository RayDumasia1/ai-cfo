import React from "react";
import { Mail, Star } from "lucide-react";
import type { ReturningFoundingMember } from "@/lib/foundingMemberState";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export default function FoundingMemberReturnCard({
  membership,
}: {
  membership: ReturningFoundingMember;
}): React.ReactElement {
  const { memberNumber, isTest, status, billingPeriodEnd } = membership;
  const subject = `Founding Member #${memberNumber} membership options`;

  return (
    <section
      className="welcome-card"
      aria-labelledby="returning-member-title"
      style={{
        flex: 1, minWidth: 0, padding: 32,
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--gold)", fontSize: 13, fontWeight: 500 }}>
        <Star size={16} aria-hidden="true" />
        {isTest ? "Test Founding Member" : "Founding Member"} #{memberNumber}
      </div>
      <h2 id="returning-member-title" style={{ fontSize: 20, fontWeight: 500, color: "var(--navy)", margin: "16px 0 8px" }}>
        Your Founding Member spot
      </h2>
      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--dim)", margin: 0 }}>
        {status === "cancelled" ? "Subscription cancelled" : "Membership inactive"}
      </p>
      {billingPeriodEnd && (
        <p style={{ fontSize: 13, color: "var(--dim)", margin: "8px 0 0" }}>
          Billing period ended <time dateTime={billingPeriodEnd}>{formatDate(billingPeriodEnd)}</time> (UTC).
        </p>
      )}
      <div style={{ borderTop: "1px solid var(--line)", margin: "24px 0" }} />
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink)", margin: 0 }}>
        After your billing cycle ends, reinstatement is handled by support, case by case.
        Contact us to discuss restoring your Founding membership, or choose a standard plan below.
        Reinstatement and the Founding rate are not guaranteed.
        {isTest
          ? "This test membership does not consume a customer spot and can be changed by an administrator."
          : "Your member number and badge remain yours permanently, and your spot is never offered to someone else."}
      </p>
      <a
        href={`mailto:hello@elidan.ai?subject=${encodeURIComponent(subject)}`}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginTop: 24, padding: "14px 16px", minHeight: 48,
          background: "var(--teal)", color: "var(--surface)", borderRadius: "var(--radius-md)",
          fontSize: 14, fontWeight: 500, lineHeight: 1.5, textAlign: "center", textDecoration: "none",
        }}
      >
        <Mail size={16} aria-hidden="true" />
        Contact support about reinstatement
      </a>
    </section>
  );
}
