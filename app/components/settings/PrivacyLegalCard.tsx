"use client";

interface PrivacyLegalCardProps {
  email: string;
}

export default function PrivacyLegalCard({ email }: PrivacyLegalCardProps) {
  function requestDeletion() {
    const subject = encodeURIComponent("Account deletion request");
    const body = encodeURIComponent(`Please delete my account: ${email}`);
    window.location.href = `mailto:hello@elidan.ai?subject=${subject}&body=${body}`;
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Privacy &amp; Legal</h2>
      <p style={cardDescStyle}>Your data and account management.</p>

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", gap: 24 }}>
          <a
            href="https://elidan.ai/privacy"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            Privacy Policy
          </a>
          <a
            href="https://elidan.ai/terms"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            Terms of Service
          </a>
        </div>

        <div style={{ borderTop: "1px solid #F4F7FA", margin: "16px 0" }} />

        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: "#0A1A2F", margin: "0 0 6px" }}>
            Delete your account
          </p>
          <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 14px" }}>
            To request deletion of your account and all associated data, contact us at{" "}
            hello@elidan.ai. We&apos;ll process your request within 30 days.
          </p>
          <button
            type="button"
            onClick={requestDeletion}
            style={deleteBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(232,69,69,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
            }}
          >
            Request account deletion
          </button>
        </div>
      </div>
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: "#0A1A2F",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6B7A8D",
  marginTop: 4,
  marginBottom: 0,
};

const linkStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#2CA6A4",
  textDecoration: "none",
};

const deleteBtnStyle: React.CSSProperties = {
  backgroundColor: "transparent",
  border: "1.5px solid #E84545",
  color: "#E84545",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 10,
  padding: "8px 16px",
  cursor: "pointer",
  transition: "background-color 0.15s",
};
