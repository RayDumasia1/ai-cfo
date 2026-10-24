export const BUSINESS_NAME_MAX = 200;
export const BUSINESS_NAME_SAVE_ERROR = "Could not confirm the save. Please try again.";

export function validateBusinessName(body: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const value = (body as Record<string, unknown>).business_name;
  if (typeof value !== "string") return { ok: false, error: "business_name must be a string." };
  const normalized = value.trim();
  if (normalized.length > BUSINESS_NAME_MAX) {
    return { ok: false, error: `Business name must be ${BUSINESS_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value: normalized || null };
}

/** Only confirm the persisted, normalized name; never display raw API errors. */
export async function requestBusinessNameUpdate(name: string): Promise<string | null> {
  const parsed = validateBusinessName({ business_name: name });
  if (!parsed.ok) throw new Error(BUSINESS_NAME_SAVE_ERROR);
  try {
    const response = await fetch("/api/account", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_name: name }),
    });
    if (!response.ok) throw new Error("Rejected save");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid confirmation");
    const data = body as Record<string, unknown>;
    if (data.success !== true || data.business_name !== parsed.value) throw new Error("Unconfirmed save");
    return parsed.value;
  } catch {
    throw new Error(BUSINESS_NAME_SAVE_ERROR);
  }
}
