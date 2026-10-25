"use client";

import { useState, useEffect } from "react";
import ManualCalculator from "./ManualCalculator";
import type { ScenarioBaseline } from "@/lib/scenarioPlanning";
import type { ActionInsert } from "@/lib/types";

const STORAGE_KEY = "elidan_whatif_collapsed";

export default function ScenarioPanel({ hasData, baseline, onCreateAction }: {
  hasData: boolean;
  baseline: ScenarioBaseline;
  onCreateAction?: (prefill: Partial<ActionInsert>) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) setCollapsed(stored === "true");
      } catch {
        // Optional UI preference must never block the scenario tool.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Keep the in-memory interaction when browser storage is unavailable.
    }
  }

  return (
    <div
      style={{
        backgroundColor: "var(--surface)",
        borderRadius: 16,
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Header — always visible */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px" }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", margin: 0 }}>Plan a cash scenario</p>
          <p style={{ fontSize: 12, fontWeight: 300, color: "var(--dim)", margin: "2px 0 0" }}>
            See how a change could affect your cash position
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="what-if-scenario-body"
          style={{
            background: "none",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--teal)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {collapsed ? "Expand ▾" : "Collapse ▴"}
        </button>
      </div>

      {/* Collapsible body */}
      <div
        id="what-if-scenario-body"
        style={{
          display: "grid",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 250ms ease-in-out",
        }}
      >
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <div style={{ borderTop: "1px solid var(--line)", padding: "20px 24px 24px" }}>
            <ManualCalculator bare baseline={baseline} hasData={hasData} onCreateAction={onCreateAction} />
          </div>
        </div>
      </div>
    </div>
  );
}
