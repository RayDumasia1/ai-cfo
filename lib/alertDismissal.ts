import type { AlertCode, SnoozeType } from "./types";

export const DISMISS_ALERT_ERROR = "Could not confirm dismissal. Refresh the dashboard before trying again.";
export const DATA_RELOAD_DISMISS_ERROR = "Import data or choose a timed snooze before dismissing this alert.";

/** Resolve only after the API confirms the dismissal was recorded. */
export async function requestAlertDismissal(alert_code: AlertCode, snooze_type: SnoozeType): Promise<void> {
  let failureMessage = DISMISS_ALERT_ERROR;
  try {
    const response = await fetch("/api/alerts/dismiss", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_code, snooze_type }),
    });
    if (response.status === 409) failureMessage = DATA_RELOAD_DISMISS_ERROR;
    if (!response.ok) throw new Error("Dismissal rejected");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("success" in body) || body.success !== true) {
      throw new Error("Dismissal not confirmed");
    }
  } catch {
    throw new Error(failureMessage);
  }
}
