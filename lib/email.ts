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
