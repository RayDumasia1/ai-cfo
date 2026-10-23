import "server-only";
import { Resend, type CreateEmailOptions } from "resend";

/** Escape dynamic text and quoted HTML attribute values, not template markup. */
export function escapeHtml(value: string | number): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

/** Provider acceptance is not inbox delivery. Notification failure never rolls back billing. */
export async function sendEmail(message: CreateEmailOptions, context: string): Promise<boolean> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send(message);
    if (error || typeof data?.id !== "string" || !data.id) {
      // Do not log provider messages, recipients, HTML, tokens, or raw exceptions.
      const status = error?.statusCode;
      console.error("email:delivery:error", {
        context,
        reason: error ? "provider_rejected" : "unconfirmed",
        ...(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
          ? { providerStatus: status } : {}),
      });
      return false;
    }
    return true;
  } catch {
    console.error("email:delivery:error", { context, reason: "send_exception" });
    return false;
  }
}
