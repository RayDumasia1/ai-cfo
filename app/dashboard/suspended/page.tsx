import { createClient } from "@/utils/supabase/server";
import { getBillingDetails } from "@/lib/db";
import SuspendedRestoreButton from "@/app/components/billing/SuspendedRestoreButton";
import LogoutButton from "@/app/components/LogoutButton";
import Link from "next/link";

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );
}

export default async function SuspendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const billing = user ? await getBillingDetails(user.id, supabase) : null;

  const memberNumber = billing?.founding_member_number ?? null;
  const graceEndsAt = billing?.founding_member_grace_ends_at ?? null;
  const withinGrace = graceEndsAt !== null && new Date(graceEndsAt) > new Date();

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
        {/* Logo */}
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

        {/* Gold badge */}
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

        {withinGrace && graceEndsAt ? (
          <>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 500,
                color: "#0A1A2F",
                margin: "0 0 16px",
              }}
            >
              Your account has been suspended
            </h1>

            {/* Days remaining countdown */}
            <div style={{ margin: "0 0 16px" }}>
              <div
                style={{
                  fontSize: 64,
                  fontWeight: 300,
                  color: "#2CA6A4",
                  lineHeight: 1,
                }}
              >
                {daysUntil(graceEndsAt)}
              </div>
              <div style={{ fontSize: 14, color: "#6B7A8D", marginTop: 4 }}>
                days remaining
              </div>
            </div>

            <p
              style={{
                fontSize: 14,
                color: "#6B7A8D",
                lineHeight: 1.6,
                maxWidth: 360,
                margin: "0 auto 12px",
              }}
            >
              Resubscribe before{" "}
              <strong style={{ color: "#344150" }}>
                {formatDateLong(graceEndsAt)}
              </strong>{" "}
              to permanently restore your Founding Member #{memberNumber} status
              and $49/month rate — locked forever once restored.
            </p>

            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#F59E0B",
                maxWidth: 360,
                margin: "0 auto 20px",
              }}
            >
              Once the grace period ends, your Founding Member status cannot be
              recovered by anyone.
            </p>

            {/* What you'll restore */}
            <div
              style={{
                backgroundColor: "#F4F7FA",
                borderRadius: 10,
                padding: "14px 20px",
                textAlign: "left",
                marginBottom: 8,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#6B7A8D",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 10px",
                }}
              >
                What you&apos;ll restore
              </p>
              {[
                "Core features — permanently",
                "$49/month locked forever",
                `Founding Member #${memberNumber} status — permanently restored`,
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 6,
                    fontSize: 13,
                    color: "#344150",
                  }}
                >
                  <span style={{ color: "#2CA6A4", flexShrink: 0 }}>✓</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            {memberNumber && (
              <SuspendedRestoreButton memberNumber={memberNumber} />
            )}
          </>
        ) : (
          <>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 500,
                color: "#0A1A2F",
                margin: "0 0 16px",
              }}
            >
              Your Founding Member status has been released
            </h1>

            <p
              style={{
                fontSize: 14,
                color: "#6B7A8D",
                lineHeight: 1.6,
                maxWidth: 360,
                margin: "0 auto 24px",
              }}
            >
              {graceEndsAt ? (
                <>
                  Your 30-day grace period ended on{" "}
                  <strong style={{ color: "#344150" }}>
                    {formatDateLong(graceEndsAt)}
                  </strong>
                  . Your Founding Member status has been permanently released.
                  <br />
                  <br />
                  You&apos;re welcome to subscribe to Elidan as a regular customer.
                </>
              ) : (
                "Your account access has been restricted. Please contact support."
              )}
            </p>

            <Link
              href="/dashboard/settings?tab=billing"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                maxWidth: 320,
                height: 44,
                backgroundColor: "#2CA6A4",
                color: "#FFFFFF",
                textDecoration: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                margin: "0 auto",
              }}
            >
              View subscription plans
            </Link>
          </>
        )}

        {/* Sign out */}
        <div style={{ marginTop: 20 }}>
          <LogoutButton variant="link" />
        </div>
      </div>
    </div>
  );
}
