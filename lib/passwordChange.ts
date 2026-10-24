export type PasswordChangeResult = { success: true } | {
  success: false;
  field?: "currentPassword" | "newPassword";
  message: string;
};

const UNCONFIRMED = "Could not confirm the password change. Try signing in with your new password before retrying or use password reset.";

/** Only known response codes become UI messages; never display provider text. */
export async function requestPasswordChange(currentPassword: string, newPassword: string): Promise<PasswordChangeResult> {
  try {
    const response = await fetch("/api/auth/password", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const data = body as Record<string, unknown>;
      if (response.ok && data.success === true) return { success: true };
      if (!response.ok) {
        if (response.status === 400 && data.code === "CURRENT_PASSWORD_INCORRECT") {
          return { success: false, field: "currentPassword", message: "Current password is incorrect." };
        }
        if (response.status === 422 && data.code === "PASSWORD_REJECTED") {
          return { success: false, field: "newPassword", message: "Choose a different password that meets the account password policy." };
        }
        if (response.status === 429 && data.code === "PASSWORD_RATE_LIMITED") {
          return { success: false, message: "Too many attempts. Please wait and try again." };
        }
        if (response.status === 503 && data.code === "PASSWORD_CHANGE_UNAVAILABLE") {
          return { success: false, message: "Password verification is temporarily unavailable. Please try again later." };
        }
        if (response.status === 401 || response.status === 403) {
          return { success: false, message: "Sign in with a verified account before changing your password." };
        }
      }
    }
  } catch {
    // A lost response may follow a successful update; never promise no change.
  }
  return { success: false, message: UNCONFIRMED };
}
