"use client";

import { useState } from "react";

interface LogoutButtonProps {
  variant: "sidebar" | "account" | "link";
}

export default function LogoutButton({ variant }: LogoutButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort — proceed with redirect even if request fails
    }
    // Hard navigation clears Next.js's in-memory router cache so the back
    // button triggers a real server request (caught by the proxy auth check).
    window.location.href = "/auth?reason=logged_out";
  }

  if (variant === "link") {
    return (
      <button
        onClick={handleLogout}
        disabled={loading}
        style={{
          background: "none",
          border: "none",
          color: "#6B7A8D",
          fontSize: 13,
          cursor: loading ? "default" : "pointer",
          padding: 0,
        }}
      >
        {loading ? "Signing out…" : "Sign out"}
      </button>
    );
  }

  if (variant === "sidebar") {
    return (
      <button
        onClick={handleLogout}
        disabled={loading}
        className="text-left text-xs font-light transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{ color: "rgba(255,255,255,0.45)" }}
      >
        {loading ? "Signing out…" : "Sign out"}
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      style={{
        backgroundColor: "transparent",
        border: "none",
        color: loading ? "#9CA3AF" : "#6B7A8D",
        fontSize: 14,
        fontWeight: 400,
        padding: "8px 0",
        cursor: loading ? "not-allowed" : "pointer",
        textAlign: "left",
        opacity: loading ? 0.7 : 1,
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.color = "#E84545"; }}
      onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.color = "#6B7A8D"; }}
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
