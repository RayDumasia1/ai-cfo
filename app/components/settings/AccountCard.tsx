"use client";

import { useState, useRef } from "react";
import { Pencil } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import LogoutButton from "@/app/components/LogoutButton";
import FoundingMemberBadge from "@/app/components/billing/FoundingMemberBadge";
import { useSubscription } from "@/hooks/useSubscription";
import type { Plan } from "@/lib/featureGates";

interface AccountCardProps {
  email: string;
  memberSince: string;
  businessName: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const PLAN_BADGE: Record<
  Plan,
  { bg: string; border: string; color: string; label: string }
> = {
  starter: { bg: "#FBF5EC", border: "#D4AF7F", color: "#7D4E00", label: "STARTER" },
  core: { bg: "#E8F7F7", border: "#2CA6A4", color: "#1A6B69", label: "CORE" },
  growth: { bg: "#EEEDFE", border: "#6366F1", color: "#3C3489", label: "GROWTH" },
  advisory: { bg: "#E8ECF0", border: "#0A1A2F", color: "#0A1A2F", label: "ADVISORY" },
  founding_member: { bg: "#FBF5EC", border: "#D4AF7F", color: "#7D4E00", label: "FOUNDING MEMBER" },
};

type SaveState = "idle" | "saving" | "saved" | "error";
type EmailState = "idle" | "saving" | "sent" | "error";

export default function AccountCard({ email, memberSince, businessName }: AccountCardProps) {
  const { subscription, loading } = useSubscription();

  // Business name state
  const [name, setName] = useState(businessName ?? "");
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSave, setNameSave] = useState<SaveState>("idle");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Email state
  const [emailEditing, setEmailEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [emailMessage, setEmailMessage] = useState("");
  const newEmailRef = useRef<HTMLInputElement>(null);

  const plan = subscription?.plan ?? "starter";
  const badge = PLAN_BADGE[plan] ?? PLAN_BADGE.starter;

  // ── Business name handlers ────────────────────────────────────────────────

  function startNameEdit() {
    setNameEditing(true);
    setNameSave("idle");
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  async function handleNameSave() {
    setNameSave("saving");
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: name }),
      });
      if (!res.ok) throw new Error("Save failed");
      setNameSave("saved");
      setNameEditing(false);
      setTimeout(() => setNameSave("idle"), 2000);
    } catch {
      setNameSave("error");
    }
  }

  function cancelNameEdit() {
    setNameEditing(false);
    setName(businessName ?? "");
    setNameSave("idle");
  }

  // ── Email handlers ────────────────────────────────────────────────────────

  function startEmailEdit() {
    setEmailEditing(true);
    setEmailState("idle");
    setEmailMessage("");
    setNewEmail("");
    setConfirmEmail("");
    setTimeout(() => newEmailRef.current?.focus(), 0);
  }

  async function handleEmailSave() {
    if (!newEmail) {
      setEmailMessage("Please enter a new email address.");
      setEmailState("error");
      return;
    }
    if (newEmail === email) {
      setEmailMessage("New email must be different from your current email.");
      setEmailState("error");
      return;
    }
    if (newEmail !== confirmEmail) {
      setEmailMessage("Email addresses do not match.");
      setEmailState("error");
      return;
    }

    setEmailState("saving");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) {
      setEmailMessage("Could not update email — please try again.");
      setEmailState("error");
      return;
    }
    setEmailMessage(
      `Confirmation email sent to ${newEmail}. Click the link to confirm your new email address.`
    );
    setEmailState("sent");
    setEmailEditing(false);
    setNewEmail("");
    setConfirmEmail("");
  }

  function cancelEmailEdit() {
    setEmailEditing(false);
    setNewEmail("");
    setConfirmEmail("");
    setEmailState("idle");
    setEmailMessage("");
  }

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Account</h2>
      <p style={cardDescStyle}>Your account details.</p>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Business Name — editable */}
        <div>
          <span style={rowLabelStyle}>Business Name</span>
          <div style={{ position: "relative", marginTop: 4 }}>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={!nameEditing}
              placeholder="Your business name"
              style={{
                width: "100%",
                height: 40,
                border: "1.5px solid #D8E2EC",
                borderRadius: 10,
                padding: "0 40px 0 12px",
                fontSize: 14,
                color: name ? "#0A1A2F" : "#6B7A8D",
                backgroundColor: nameEditing ? "#FFFFFF" : "#FAFBFC",
                outline: "none",
                boxSizing: "border-box",
                cursor: nameEditing ? "text" : "default",
              }}
              onFocus={(e) => {
                if (nameEditing) {
                  e.currentTarget.style.borderColor = "#2CA6A4";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(44,166,164,0.12)";
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#D8E2EC";
                e.currentTarget.style.boxShadow = "none";
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && nameEditing) handleNameSave(); }}
            />
            {!nameEditing && (
              <button
                type="button"
                onClick={startNameEdit}
                aria-label="Edit business name"
                style={pencilBtnStyle}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          {nameEditing && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={handleNameSave}
                disabled={nameSave === "saving"}
                style={saveBtnStyle(nameSave === "saving")}
              >
                {nameSave === "saving" ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={cancelNameEdit} style={cancelBtnStyle}>
                Cancel
              </button>
              {nameSave === "error" && (
                <span style={{ fontSize: 13, color: "#E84545" }}>Could not save — try again.</span>
              )}
            </div>
          )}
          {nameSave === "saved" && !nameEditing && (
            <span style={{ fontSize: 13, color: "#2CA6A4", display: "block", marginTop: 4 }}>
              Saved ✓
            </span>
          )}
        </div>

        {/* Email — editable */}
        <div>
          <span style={rowLabelStyle}>Email</span>
          {!emailEditing ? (
            <div style={{ position: "relative", marginTop: 4 }}>
              <div style={{
                height: 40,
                border: "1.5px solid #D8E2EC",
                borderRadius: 10,
                padding: "0 40px 0 12px",
                fontSize: 14,
                color: "#0A1A2F",
                backgroundColor: "#FAFBFC",
                display: "flex",
                alignItems: "center",
              }}>
                {email}
              </div>
              <button
                type="button"
                onClick={startEmailEdit}
                aria-label="Change email"
                style={pencilBtnStyle}
              >
                <Pencil size={14} />
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                ref={newEmailRef}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
                style={emailInputStyle}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#2CA6A4";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(44,166,164,0.12)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#D8E2EC";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              <input
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder="Confirm new email"
                style={emailInputStyle}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#2CA6A4";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(44,166,164,0.12)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#D8E2EC";
                  e.currentTarget.style.boxShadow = "none";
                }}
                onKeyDown={(e) => { if (e.key === "Enter") handleEmailSave(); }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleEmailSave}
                  disabled={emailState === "saving"}
                  style={saveBtnStyle(emailState === "saving")}
                >
                  {emailState === "saving" ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={cancelEmailEdit} style={cancelBtnStyle}>
                  Cancel
                </button>
                {emailState === "error" && (
                  <span style={{ fontSize: 13, color: "#E84545" }}>{emailMessage}</span>
                )}
              </div>
            </div>
          )}
          <p style={{ fontSize: 12, color: "#6B7A8D", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
            This email is used to log in and receive all Elidan notifications. A confirmation link will be sent to your new email before any changes take effect.
          </p>
          {emailState === "sent" && (
            <p style={{ fontSize: 13, color: "#6B7A8D", marginTop: 6, marginBottom: 0 }}>
              {emailMessage}
            </p>
          )}
        </div>

        {/* Member since — read only */}
        <div>
          <span style={rowLabelStyle}>Member since</span>
          <p style={{ fontSize: 14, color: "#344150", marginTop: 4, marginBottom: 0 }}>
            {formatDate(memberSince)}
          </p>
        </div>

        {/* Plan badge */}
        <div>
          <span style={rowLabelStyle}>Plan</span>
          <div style={{ marginTop: 4 }}>
            {loading ? (
              <span style={{
                fontSize: 11, fontWeight: 500, color: "#6B7A8D",
                backgroundColor: "#F4F7FA", border: "1px solid #D8E2EC",
                borderRadius: 4, padding: "2px 7px", letterSpacing: "0.04em",
              }}>
                —
              </span>
            ) : plan === "founding_member" ? (
              <FoundingMemberBadge
                memberNumber={subscription?.founding_member_number ?? null}
                featureTier={subscription?.feature_tier ?? "starter"}
              />
            ) : (
              <span style={{
                fontSize: 11, fontWeight: 600, color: badge.color,
                backgroundColor: badge.bg, border: `1px solid ${badge.border}`,
                borderRadius: 4, padding: "2px 7px", letterSpacing: "0.04em",
              }}>
                {badge.label}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <LogoutButton variant="account" />
      </div>
    </section>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: 24,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: "#0A1A2F",
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6B7A8D",
  marginTop: 4,
  marginBottom: 0,
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "#6B7A8D",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const pencilBtnStyle: React.CSSProperties = {
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
};

function saveBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    backgroundColor: disabled ? "#6B7A8D" : "#2CA6A4",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const cancelBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 13,
  color: "#6B7A8D",
  cursor: "pointer",
  padding: 0,
};

const emailInputStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  border: "1.5px solid #D8E2EC",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 14,
  color: "#0A1A2F",
  backgroundColor: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};
