import type { FeatureTier } from "@/lib/featureGates";

interface FoundingMemberBadgeProps {
  memberNumber: number | null;
  featureTier: FeatureTier;
}

export default function FoundingMemberBadge({
  memberNumber,
  featureTier,
}: FoundingMemberBadgeProps) {
  let subText: string | null = null;
  let subColor = "#6B7A8D";

  if (featureTier === "core") {
    subText = "Core features · Locked forever";
  } else if (featureTier === "suspended") {
    subText = "Account suspended · Grace period active";
    subColor = "#F59E0B";
  }

  return (
    <div>
      <span
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
        }}
      >
        ✦ Founding Member{memberNumber ? ` #${memberNumber}` : ""}
      </span>
      {subText && (
        <p style={{ fontSize: 12, color: subColor, margin: "4px 0 0" }}>
          {subText}
        </p>
      )}
    </div>
  );
}
