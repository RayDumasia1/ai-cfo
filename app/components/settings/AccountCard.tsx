"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

export default function AccountCard({ email, memberSince }: AccountCardProps) {
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth");
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
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, color: "#344150" }}>Starter</span>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#92400e",
              backgroundColor: "#fef3c7",
              border: "1px solid #D4AF7F",
              borderRadius: 4,
              padding: "2px 7px",
              letterSpacing: "0.04em",
            }}>
              STARTER
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #D8E2EC" }}>
        <button
          onClick={handleSignOut}
          style={secondaryBtnStyle}
        >
          Sign out
        </button>
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

const secondaryBtnStyle: React.CSSProperties = {
  backgroundColor: "transparent",
  color: "#344150",
  border: "1.5px solid #D8E2EC",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
