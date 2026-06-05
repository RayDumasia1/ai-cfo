import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM = "Elidan <no-reply@elidan.ai>";

function wrapEmail(bodyHtml: string, previewText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${previewText}</title>
</head>
<body style="margin:0;padding:0;background:#F4F7FA;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FA;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(10,26,47,0.10);">
        <tr>
          <td style="background:#0A1A2F;padding:24px 32px;">
            <span style="font-size:18px;font-weight:600;color:#FFFFFF;letter-spacing:-0.3px;">Elidan</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#F4F7FA;padding:16px 32px;border-top:1px solid #D8E2EC;">
            <p style="font-size:12px;color:#6B7A8D;margin:0;">
              Elidan &middot; You're receiving this because you have an account at elidan.ai.
              Questions? Contact us at <a href="mailto:hello@elidan.ai" style="color:#2CA6A4;text-decoration:none;">hello@elidan.ai</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendCfoCallConfirmation(
  to: string,
  calendlyUrl: string
): Promise<void> {
  const body = `
    <h2 style="font-size:20px;font-weight:600;color:#0A1A2F;margin:0 0 8px;">Your CFO call is confirmed</h2>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 8px;">
      Your payment of $150 has been received.
    </p>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 24px;">
      One of our certified financial advisors will review your Elidan dashboard before your call
      so they arrive fully prepared with insights specific to your business.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${calendlyUrl}"
         style="display:inline-block;background:#2CA6A4;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 24px;border-radius:8px;">
        Book your call &rarr;
      </a>
    </p>
    <p style="font-size:13px;color:#6B7A8D;margin:0 0 8px;">
      You'll receive a confirmation with your advisor's details 24 hours before your call.
    </p>
    <p style="font-size:13px;color:#6B7A8D;margin:0;">
      Questions? Reply to this email or contact us at
      <a href="mailto:hello@elidan.ai" style="color:#2CA6A4;text-decoration:none;">hello@elidan.ai</a>
    </p>
  `;

  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Your CFO call is confirmed — book your time below",
      html: wrapEmail(body, "Your CFO call is confirmed"),
    });
  } catch (err) {
    console.error("email:sendCfoCallConfirmation:error", err);
  }
}

export async function sendFoundingMemberWelcomeEmail(
  to: string,
  memberNumber: number
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const body = `
    <h2 style="font-size:20px;font-weight:600;color:#0A1A2F;margin:0 0 8px;">
      You're in.
    </h2>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 8px;">
      You're <strong style="color:#7D4E00;">Founding Member #${memberNumber}</strong> of
      Elidan AI — one of the first ${memberNumber} businesses to join us before we open to the public.
    </p>
    <p style="font-size:13px;font-weight:600;color:#344150;margin:16px 0 8px;">Here's what's included:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Core features — AI Insights, Ask your CFO, QuickBooks + Xero sync, Weekly CFO summary</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#7D4E00;font-weight:600;">$49/month — locked permanently, forever, regardless of future price increases</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Founding Member #${memberNumber} badge on your account</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Direct input into our product roadmap</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Priority support from our team</td></tr>
    </table>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 24px;">
      Your Core features are active now and stay active as long as you remain subscribed.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${appUrl}/dashboard"
         style="display:inline-block;background:#2CA6A4;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 24px;border-radius:8px;">
        Go to your dashboard &rarr;
      </a>
    </p>
    <div style="background:#F4F7FA;border-radius:8px;padding:16px;margin:0 0 24px;">
      <p style="font-size:13px;font-weight:600;color:#344150;margin:0 0 10px;">Your Founding Member terms:</p>
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Core features at $49/month — locked permanently</td></tr>
        <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Rate never increases regardless of future price changes</td></tr>
        <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">Cancel anytime — 30-day grace period from billing end to restore your status</td></tr>
        <tr><td style="padding:3px 0;font-size:13px;color:#344150;">✓&nbsp;</td><td style="padding:3px 0;font-size:13px;color:#344150;">After 30 days post-cancellation, Founding Member status is permanently released</td></tr>
      </table>
      <p style="font-size:13px;color:#344150;margin:10px 0 0;">As long as you stay subscribed, you keep everything.</p>
    </div>
    <p style="font-size:13px;color:#344150;line-height:1.6;margin:0 0 8px;">
      Thank you for betting on us early. We won't let you down.
    </p>
    <p style="font-size:13px;color:#344150;margin:0;">
      Rayan Dumasia<br>Founder, Elidan AI
    </p>
  `;
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Welcome to Elidan — you're Founding Member #${memberNumber} 🎉`,
      html: wrapEmail(body, `Welcome to Elidan — Founding Member #${memberNumber}`),
    });
  } catch (err) {
    console.error("email:sendFoundingMemberWelcomeEmail:error", err);
  }
}

export async function sendFoundingMemberRestoreEmail(
  to: string,
  memberNumber: number
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const body = `
    <h2 style="font-size:20px;font-weight:600;color:#0A1A2F;margin:0 0 8px;">
      You're back.
    </h2>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 16px;">
      Your <strong style="color:#7D4E00;">Founding Member #${memberNumber}</strong> status has been fully restored.
    </p>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 16px;">
      Your $49/month permanently locked rate is active and your Core features are available again.
    </p>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 24px;">
      There is no expiry on your Founding Member status — as long as you stay subscribed, you keep everything.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${appUrl}/dashboard"
         style="display:inline-block;background:#2CA6A4;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 24px;border-radius:8px;">
        Go to your dashboard &rarr;
      </a>
    </p>
  `;
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Welcome back — your Founding Member status has been restored",
      html: wrapEmail(body, "Your Founding Member status has been restored"),
    });
  } catch (err) {
    console.error("email:sendFoundingMemberRestoreEmail:error", err);
  }
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function sendFoundingMemberCancelledEmail(
  to: string,
  memberNumber: number,
  billingPeriodEnd: string
): Promise<void> {
  const billingEndFormatted = formatDateLong(billingPeriodEnd);
  const body = `
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 16px;">
      Your subscription has been cancelled.
    </p>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 16px;">
      Your Core features remain active until <strong>${billingEndFormatted}</strong>.
      After that date your account access will end.
    </p>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 24px;">
      Changed your mind? If you'd like to restore your
      <strong style="color:#7D4E00;">Founding Member #${memberNumber}</strong> status,
      email us at <a href="mailto:hello@elidan.ai" style="color:#2CA6A4;text-decoration:none;">hello@elidan.ai</a>
      within 30 days of your billing period ending and we'll take care of it manually.
    </p>
    <p style="font-size:13px;color:#344150;line-height:1.6;margin:0 0 8px;">
      Thank you for being a Founding Member.
    </p>
    <p style="font-size:13px;color:#344150;margin:0;">
      Rayan Dumasia<br>Founder, Elidan AI
    </p>
  `;
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Your Elidan subscription has been cancelled",
      html: wrapEmail(body, "Your Elidan subscription has been cancelled"),
    });
  } catch (err) {
    console.error("email:sendFoundingMemberCancelledEmail:error", err);
  }
}

export async function sendPaymentFailedEmail(
  to: string,
  appUrl: string
): Promise<void> {
  const billingUrl = `${appUrl}/dashboard/settings?tab=billing`;
  const body = `
    <h2 style="font-size:20px;font-weight:600;color:#0A1A2F;margin:0 0 8px;">Action required — payment failed</h2>
    <p style="font-size:14px;color:#344150;line-height:1.6;margin:0 0 24px;">
      We were unable to process your payment for your Elidan subscription.
      Please update your payment method to continue accessing your financial dashboard.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${billingUrl}"
         style="display:inline-block;background:#2CA6A4;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 24px;border-radius:8px;">
        Update payment method &rarr;
      </a>
    </p>
    <p style="font-size:13px;color:#6B7A8D;margin:0;">
      If you need help, contact us at
      <a href="mailto:hello@elidan.ai" style="color:#2CA6A4;text-decoration:none;">hello@elidan.ai</a>
    </p>
  `;

  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Action required — payment failed for your Elidan subscription",
      html: wrapEmail(body, "Payment failed — action required"),
    });
  } catch (err) {
    console.error("email:sendPaymentFailedEmail:error", err);
  }
}
