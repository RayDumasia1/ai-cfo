"use client";

import { useState } from "react";

interface LogoutButtonProps {
  variant: "sidebar" | "account";
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
        color: loading ? "#9CA3AF" : "#344150",
        border: "1.5px solid #D8E2EC",
        borderRadius: 6,
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 500,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
