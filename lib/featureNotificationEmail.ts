import "server-only";
import type { CreateEmailOptions } from "resend";
import { escapeHtml } from "@/lib/emailDelivery";

export type FeatureNotificationMessageType =
  | "feature_customer_confirmation"
  | "feature_internal_notification";

const FEATURE_LABELS: Record<string, string> = {
  ai_insights: "AI insights",
  cfo_call: "CFO assistance",
  tier_advisory: "Advisory",
  tier_core: "Core",
  tier_growth: "Growth",
};

export function buildFeatureNotificationEmail(input: {
  email: string;
  feature: string;
  messageType: FeatureNotificationMessageType;
  userId?: string | null;
  createdAt?: string | null;
}): CreateEmailOptions {
  const featureLabel = FEATURE_LABELS[input.feature] ?? input.feature;
  if (input.messageType === "feature_customer_confirmation") {
    return {
      from: "Elidan AI <hello@elidan.ai>",
      to: input.email,
      subject: `You're on the list for ${featureLabel}`,
      html: `<p>You’re on the list for <strong>${escapeHtml(featureLabel)}</strong>.</p><p>We’ll email you at this address when it becomes available. No purchase or plan change has been made.</p>`,
    };
  }

  return {
    from: "Elidan AI <hello@elidan.ai>",
    to: "hello@elidan.ai",
    subject: `Notify me: ${input.feature}`,
    html: `<p>A user has requested notification for a coming soon feature.</p>
      <p><strong>Feature:</strong> ${escapeHtml(input.feature)}</p>
      <p><strong>Email:</strong> ${escapeHtml(input.email)}</p>
      <p><strong>User ID:</strong> ${escapeHtml(input.userId ?? "Not signed in")}</p>
      <p><strong>Time:</strong> ${escapeHtml(input.createdAt ?? "Unavailable")}</p>`,
  };
}
