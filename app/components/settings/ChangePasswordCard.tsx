"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { requestPasswordChange } from "@/lib/passwordChange";

type SaveState = "idle" | "loading" | "success";

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
  const [formError, setFormError] = useState("");
  const submitting = useRef(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    if (successTimer.current) clearTimeout(successTimer.current);
    setSaveState("idle");
    setFormError("");
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
    submitting.current = true;
    setSaveState("loading");

    try {
      const result = await requestPasswordChange(currentPassword, newPassword);
      if (result.success) {
        setSaveState("success");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        successTimer.current = setTimeout(() => setSaveState("idle"), 3000);
      } else {
        if (result.field) setErrors({ [result.field]: result.message });
        else setFormError(result.message);
        setSaveState("idle");
      }
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Change Password</h2>
      <p style={cardDescStyle}>Update your account password.</p>

      <form onSubmit={handleSubmit} aria-busy={saveState === "loading"} style={{ marginTop: 24 }}>
        <fieldset disabled={saveState === "loading"} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="sr-only">Change account password</legend>
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
              backgroundColor: saveState === "loading" ? "var(--dim)" : "var(--teal)",
              color: "var(--surface)",
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
            <span role="status" style={{ fontSize: 13, color: "var(--color-success-text)" }}>
              Password updated successfully ✓
            </span>
          )}
        </div>
        </fieldset>
        {formError && <p role="alert" style={{ fontSize: 13, color: "var(--danger)", marginBottom: 0 }}>{formError}</p>}
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
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : helperText ? `${id}-help` : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            border: `1px solid ${error ? "var(--danger)" : "var(--line)"}`,
            borderRadius: 6,
            padding: "8px 40px 8px 12px",
            fontSize: 13,
            color: "var(--ink)",
            backgroundColor: "var(--cloud)",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--teal)")}
          onBlur={(e) =>
            (e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--line)")
          }
        />
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={show}
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
            color: "var(--dim)",
          }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" style={{ fontSize: 12, color: "var(--danger)", marginTop: 4, marginBottom: 0 }}>
          {error}
        </p>
      ) : helperText ? (
        <p id={`${id}-help`} style={{ fontSize: 12, color: "var(--dim)", marginTop: 4, marginBottom: 0 }}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  boxShadow: "var(--shadow-sm)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: "var(--navy)",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--dim)",
  marginTop: 4,
  marginBottom: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "var(--dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
