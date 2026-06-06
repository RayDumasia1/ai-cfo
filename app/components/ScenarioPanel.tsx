"use client";

import { useState, useEffect } from "react";
import ManualCalculator from "./ManualCalculator";

const STORAGE_KEY = "elidan_whatif_collapsed";

export default function ScenarioPanel({ hasData }: { hasData: boolean }) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid #D8E2EC",
        boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
      }}
    >
      {/* Header — always visible */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px" }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, color: "#0A1A2F", margin: 0 }}>What-If Scenario</p>
          <p style={{ fontSize: 12, fontWeight: 300, color: "#6B7A8D", margin: "2px 0 0" }}>
            Model a scenario to plan ahead
          </p>
        </div>
        <button
          onClick={toggle}
          style={{
            background: "none",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            color: "#2CA6A4",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {collapsed ? "Expand ▾" : "Collapse ▴"}
        </button>
      </div>

      {/* Collapsible body */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: collapsed ? "0" : "800px",
          transition: "max-height 250ms ease-in-out",
        }}
      >
        <div style={{ borderTop: "1px solid #D8E2EC", padding: "20px 24px 24px" }}>
          <ManualCalculator bare />
        </div>
      </div>
    </div>
  );
}
