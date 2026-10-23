import type { SnoozeType } from "./types";

export const LOAD_PREFERENCES_ERROR = "Couldn't load your alert preferences. Please retry.";
export const SAVE_PREFERENCES_ERROR = "Couldn't save your alert preferences. Please try again.";

export function isSnoozeType(value: unknown): value is SnoozeType {
  return value === "data_reload" || value === "24h" || value === "7d";
}

function discardLegacyPreference() {
  try {
    // This browser-wide key has no account identity. Never read it or copy it
    // into the currently authenticated account's server-side preference.
    window.localStorage.removeItem("elidan_snooze_duration");
  } catch {
    // Storage may be unavailable; server preferences do not depend on it.
  }
}

export async function loadAlertPreference(): Promise<SnoozeType> {
  discardLegacyPreference();
  try {
    const response = await fetch("/api/settings/preferences", { cache: "no-store" });
    if (!response.ok) throw new Error("Preference lookup failed");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("snooze_duration" in body) || !isSnoozeType(body.snooze_duration)) {
      throw new Error("Invalid preference response");
    }
    return body.snooze_duration;
  } catch {
    throw new Error(LOAD_PREFERENCES_ERROR);
  }
}

export async function saveAlertPreference(value: SnoozeType): Promise<void> {
  try {
    if (!isSnoozeType(value)) throw new Error("Invalid preference");
    const response = await fetch("/api/settings/preferences", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snooze_duration: value }),
    });
    if (!response.ok) throw new Error("Preference save failed");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("success" in body) || body.success !== true) {
      throw new Error("Preference save unconfirmed");
    }
  } catch {
    throw new Error(SAVE_PREFERENCES_ERROR);
  }
}
