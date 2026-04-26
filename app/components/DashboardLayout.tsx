"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";

function RisingColumnMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 42 52" fill="none" className={className} aria-hidden="true">
      <rect x="0"  y="24" width="10" height="28" rx="2" fill="#344150" />
      <rect x="14" y="12" width="10" height="40" rx="2" fill="#F4F7FA" />
      <rect x="28" y="0"  width="10" height="52" rx="2" fill="#F4F7FA" />
      <polygon points="28,0 38,8 28,8" fill="#2CA6A4" />
      <polygon points="28,0 38,8 38,0" fill="#0A1A2F" />
      <line
        x1="28" y1="0" x2="38" y2="8"
        stroke="#D4AF7F" strokeWidth="1.5" strokeLinecap="round"
      />
      <circle cx="28" cy="0" r="2.5" fill="#2CA6A4" />
    </svg>
  );
}

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Scenarios", href: "/dashboard/scenarios" },
  { label: "Reports",   href: "/reports"   },
  { label: "Settings",  href: "/dashboard/settings" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { showWarning, stayLoggedIn, logOutNow } = useSessionTimeout();

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        className="w-[220px] shrink-0 flex flex-col"
        style={{ backgroundColor: "var(--navy)" }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-3 px-5 py-5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <RisingColumnMark className="h-9 w-auto" />
          <div>
            <p className="text-white text-sm font-medium leading-none">
              Elidan AI
            </p>
            <p
              className="mt-1 text-[10px] font-light tracking-widest uppercase"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              Financial Intelligence
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <a
                key={item.label}
                href={item.href}
                className={`w-full text-left flex items-center px-3 py-2 text-sm transition-colors ${
                  isActive ? "font-medium" : "font-light hover:text-white"
                }`}
                style={{
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: isActive ? "rgba(44,166,164,0.12)" : "transparent",
                  color: isActive ? "var(--teal)" : "rgba(255,255,255,0.45)",
                  textDecoration: "none",
                  display: "block",
                }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Footer — Sign Out */}
        <div
          className="px-5 py-4 flex flex-col gap-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <LogoutButton variant="sidebar" />
          <p
            className="text-[11px] font-light"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            v0.1 · Concept
          </p>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="flex-1 bg-cloud overflow-auto">{children}</main>

      {/* ── Session timeout warning modal ───────────────────────── */}
      {showWarning && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 12,
              boxShadow: "0 8px 32px rgba(10,26,47,0.18)",
              padding: 32,
              maxWidth: 380,
              width: "90%",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "#0A1A2F",
                marginBottom: 8,
              }}
            >
              Your session is about to expire
            </p>
            <p
              style={{
                fontSize: 13,
                color: "#475569",
                marginBottom: 24,
              }}
            >
              You&apos;ll be logged out in 1 minute due to inactivity. Click
              below to stay logged in.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={stayLoggedIn}
                style={{
                  backgroundColor: "#14B8A6",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 6,
                  padding: "9px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Stay logged in
              </button>
              <button
                onClick={logOutNow}
                style={{
                  backgroundColor: "transparent",
                  color: "#475569",
                  border: "1.5px solid #D8E2EC",
                  borderRadius: 6,
                  padding: "9px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Log out now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
