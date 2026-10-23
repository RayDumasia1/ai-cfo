export const NOTIFY_REGISTRATION_ERROR = "We couldn't add you to the list. Please try again.";

/** Only a confirmed registration response may update the welcome success state. */
export async function registerFeatureNotification(email: string, feature: string): Promise<void> {
  try {
    const response = await fetch("/api/notify-me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, feature }),
    });
    if (!response.ok) throw new Error("Registration rejected");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("success" in body) || body.success !== true) {
      throw new Error("Registration not confirmed");
    }
  } catch {
    throw new Error(NOTIFY_REGISTRATION_ERROR);
  }
}
