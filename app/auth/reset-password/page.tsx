"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<{
    newPassword?: string;
    confirmPassword?: string;
    general?: string;
  }>({});

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const newErrors: typeof errors = {};

    if (newPassword.length < 8) {
      newErrors.newPassword = "Password must be at least 8 characters.";
    }
    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        if (
          error.message.toLowerCase().includes("expired") ||
          error.message.toLowerCase().includes("invalid")
        ) {
          setErrors({
            general:
              "This reset link has expired or is invalid. Please request a new one.",
          });
        } else {
          setErrors({ general: "Something went wrong — please try again." });
        }
      } else {
        setSuccess(true);
        setTimeout(() => router.push("/dashboard"), 2000);
      }
    } catch {
      setErrors({ general: "Something went wrong — please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "var(--cloud)" }}
    >
      <div
        className="w-full max-w-sm bg-surface"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-md)",
          padding: "2rem",
        }}
      >
        {/* Logo */}
        <div className="mb-6 text-center">
          <p className="text-xl font-medium" style={{ color: "var(--ink)" }}>
            Elidan AI
          </p>
          <p
            className="mt-1 text-xs font-light tracking-widest uppercase"
            style={{ color: "var(--dim)" }}
          >
            Financial Intelligence
          </p>
        </div>

        {success ? (
          <div className="text-sm text-center">
            <p className="font-medium" style={{ color: "var(--ink)" }}>
              Password updated successfully.
            </p>
            <p className="mt-2 font-light" style={{ color: "var(--dim)" }}>
              Redirecting you to your dashboard…
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1
                className="text-base font-semibold"
                style={{ color: "var(--ink)", margin: 0 }}
              >
                Choose a new password
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--ink)" }}
                >
                  New password
                </label>
                <input
                  id="new-password"
                  name="new_password"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border px-4 py-2.5 text-sm outline-none transition"
                  style={{
                    borderRadius: "var(--radius-sm)",
                    borderColor: errors.newPassword ? "#ef4444" : "var(--line)",
                    backgroundColor: "var(--cloud)",
                    color: "var(--ink)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = errors.newPassword
                      ? "#ef4444"
                      : "var(--line)")
                  }
                />
                {errors.newPassword ? (
                  <p className="mt-1 text-xs text-red-500">
                    {errors.newPassword}
                  </p>
                ) : (
                  <p
                    className="mt-1 text-xs"
                    style={{ color: "var(--dim)" }}
                  >
                    Minimum 8 characters
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--ink)" }}
                >
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  name="confirm_password"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border px-4 py-2.5 text-sm outline-none transition"
                  style={{
                    borderRadius: "var(--radius-sm)",
                    borderColor: errors.confirmPassword
                      ? "#ef4444"
                      : "var(--line)",
                    backgroundColor: "var(--cloud)",
                    color: "var(--ink)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--teal)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = errors.confirmPassword
                      ? "#ef4444"
                      : "var(--line)")
                  }
                />
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-red-500">
                    {errors.confirmPassword}
                  </p>
                )}
              </div>

              {errors.general && (
                <div>
                  <p className="text-xs text-red-500">{errors.general}</p>
                  {errors.general.includes("expired") && (
                    <a
                      href="/auth/forgot-password"
                      className="mt-1 block text-xs"
                      style={{ color: "#2CA6A4", textDecoration: "none" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.textDecoration = "underline")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.textDecoration = "none")
                      }
                    >
                      Request a new reset link
                    </a>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-sm font-medium text-white transition"
                style={{
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: loading ? "var(--dim)" : "var(--teal)",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Please wait…" : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
