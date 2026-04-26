"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type SaveState = "idle" | "loading" | "success" | "error";

export default function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [errors, setErrors] = useState<{
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const newErrors: typeof errors = {};

    if (!currentPassword) {
      newErrors.currentPassword = "Current password is required.";
    }
    if (!newPassword) {
      newErrors.newPassword = "New password is required.";
    } else if (newPassword.length < 8) {
      newErrors.newPassword = "Password must be at least 8 characters.";
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = "Please confirm your new password.";
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setSaveState("loading");

    try {
      const res = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.ok) {
        setSaveState("success");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => setSaveState("idle"), 3000);
      } else {
        const data = await res.json();
        if (data?.error === "Current password is incorrect") {
          setErrors({ currentPassword: "Current password is incorrect." });
        } else {
          setErrors({ currentPassword: "Something went wrong — please try again." });
        }
        setSaveState("idle");
      }
    } catch {
      setErrors({ currentPassword: "Something went wrong — please try again." });
      setSaveState("idle");
    }
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Change Password</h2>
      <p style={cardDescStyle}>Update your account password.</p>

      <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PasswordField
            id="current-password"
            name="current_password"
            label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrent}
            onToggle={() => setShowCurrent((v) => !v)}
            error={errors.currentPassword}
          />

          <PasswordField
            id="new-password"
            name="new_password"
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggle={() => setShowNew((v) => !v)}
            error={errors.newPassword}
            helperText="Minimum 8 characters"
          />

          <PasswordField
            id="confirm-new-password"
            name="confirm_new_password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            error={errors.confirmPassword}
          />
        </div>

        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="submit"
            disabled={saveState === "loading"}
            style={{
              backgroundColor: saveState === "loading" ? "#6B7A8D" : "#2CA6A4",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 500,
              cursor: saveState === "loading" ? "not-allowed" : "pointer",
            }}
          >
            {saveState === "loading" ? "Updating…" : "Update password"}
          </button>

          {saveState === "success" && (
            <span style={{ fontSize: 13, color: "#2CA6A4" }}>
              Password updated successfully ✓
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

interface PasswordFieldProps {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  error?: string;
  helperText?: string;
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
  show,
  onToggle,
  error,
  helperText,
}: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <div style={{ position: "relative", marginTop: 6 }}>
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            border: `1px solid ${error ? "#ef4444" : "#D8E2EC"}`,
            borderRadius: 6,
            padding: "8px 40px 8px 12px",
            fontSize: 13,
            color: "#344150",
            backgroundColor: "#F8FAFC",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#2CA6A4")}
          onBlur={(e) =>
            (e.currentTarget.style.borderColor = error ? "#ef4444" : "#D8E2EC")
          }
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          title={show ? "Hide password" : "Show password"}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            color: "#6B7A8D",
          }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error ? (
        <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4, marginBottom: 0 }}>
          {error}
        </p>
      ) : helperText ? (
        <p style={{ fontSize: 12, color: "#6B7A8D", marginTop: 4, marginBottom: 0 }}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#0A1A2F",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6B7A8D",
  marginTop: 4,
  marginBottom: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#6B7A8D",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
