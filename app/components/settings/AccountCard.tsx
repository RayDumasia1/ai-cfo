"use client";

import LogoutButton from "@/app/components/LogoutButton";
import { useSubscription } from "@/hooks/useSubscription";
import type { Plan } from "@/lib/featureGates";

interface AccountCardProps {
  email: string;
  memberSince: string; // ISO string from auth.users.created_at
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

const PLAN_BADGE: Record<
  Plan,
  { bg: string; border: string; color: string; label: string }
> = {
  starter: {
    bg: "#FBF5EC",
    border: "#D4AF7F",
    color: "#7D4E00",
    label: "STARTER",
  },
  core: {
    bg: "#E8F7F7",
    border: "#2CA6A4",
    color: "#1A6B69",
    label: "CORE",
  },
  growth: {
    bg: "#EEEDFE",
    border: "#6366F1",
    color: "#3C3489",
    label: "GROWTH",
  },
  advisory: {
    bg: "#E8ECF0",
    border: "#0A1A2F",
    color: "#0A1A2F",
    label: "ADVISORY",
  },
  founding_member: {
    bg: "#FBF5EC",
    border: "#D4AF7F",
    color: "#7D4E00",
    label: "FOUNDING MEMBER",
  },
};

export default function AccountCard({ email, memberSince }: AccountCardProps) {
  const { subscription, loading } = useSubscription();

  const plan = subscription?.plan ?? "starter";
  const badge = PLAN_BADGE[plan] ?? PLAN_BADGE.starter;

  let planSubText: string | null = null;
  if (plan === "founding_member") {
    const expires = subscription?.founding_member_expires_at;
    if (expires && new Date() < new Date(expires)) {
      planSubText = `Core features · Locked until ${formatMonth(expires)}`;
    } else {
      planSubText = "Starter features";
    }
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Account</h2>
      <p style={cardDescStyle}>Your account details.</p>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Row label="Email" value={email} />
        <Row label="Member since" value={formatDate(memberSince)} />
        <div>
          <span style={rowLabelStyle}>Plan</span>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {loading ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#6B7A8D",
                  backgroundColor: "#F4F7FA",
                  border: "1px solid #D8E2EC",
                  borderRadius: 4,
                  padding: "2px 7px",
                  letterSpacing: "0.04em",
                }}
              >
                —
              </span>
            ) : (
              <>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: badge.color,
                    backgroundColor: badge.bg,
                    border: `1px solid ${badge.border}`,
                    borderRadius: 4,
                    padding: "2px 7px",
                    letterSpacing: "0.04em",
                  }}
                >
                  {badge.label}
                </span>
                {planSubText && (
                  <span style={{ fontSize: 12, color: "#6B7A8D" }}>
                    {planSubText}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #D8E2EC" }}>
        <LogoutButton variant="account" />
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={rowLabelStyle}>{label}</span>
      <p style={{ fontSize: 14, color: "#344150", marginTop: 4, marginBottom: 0 }}>
        {value}
      </p>
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#0A1A2F",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6B7A8D",
  marginTop: 4,
  marginBottom: 0,
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#6B7A8D",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
