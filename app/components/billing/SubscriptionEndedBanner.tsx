import Link from "next/link";

interface SubscriptionEndedBannerProps {
  memberNumber: number | null;
}

export default function SubscriptionEndedBanner({
  memberNumber,
}: SubscriptionEndedBannerProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#F4F7FA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          boxShadow: "0 2px 8px rgba(10,26,47,0.10)",
          padding: 40,
          width: "100%",
          maxWidth: 480,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "#0A1A2F",
            marginBottom: 32,
            letterSpacing: "-0.3px",
          }}
        >
          Elidan
        </div>

        {memberNumber && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              backgroundColor: "#FBF5EC",
              border: "1px solid #D4AF7F",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 500,
              color: "#7D4E00",
              marginBottom: 20,
            }}
          >
            ✦ Founding Member #{memberNumber}
          </div>
        )}

        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#0A1A2F",
            margin: "0 0 12px",
          }}
        >
          Your subscription has ended
        </h1>

        <p
          style={{
            fontSize: 14,
            color: "#6B7A8D",
            lineHeight: 1.6,
            maxWidth: 360,
            margin: "0 auto 32px",
          }}
        >
          Contact us at{" "}
          <a
            href="mailto:hello@elidan.ai"
            style={{ color: "#2CA6A4", textDecoration: "none" }}
          >
            hello@elidan.ai
          </a>{" "}
          to restore your Founding Member access or to subscribe to a new plan.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxWidth: 320,
            margin: "0 auto",
          }}
        >
          <a
            href="mailto:hello@elidan.ai"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 44,
              backgroundColor: "#2CA6A4",
              color: "#FFFFFF",
              textDecoration: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Email us
          </a>
          <Link
            href="/dashboard/settings?tab=billing"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 44,
              backgroundColor: "transparent",
              color: "#344150",
              textDecoration: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              border: "1.5px solid #D8E2EC",
            }}
          >
            View plans
          </Link>
        </div>
      </div>
    </div>
  );
}
