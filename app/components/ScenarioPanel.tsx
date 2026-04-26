"use client";

import { useState } from "react";
import ManualCalculator from "./ManualCalculator";

export default function ScenarioPanel({ hasData }: { hasData: boolean }) {
  const [expanded, setExpanded] = useState(!hasData);

  return (
    <div
      className="bg-surface"
      style={{
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Header row — always visible */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <p className="text-sm font-medium text-ink">What-If Scenario</p>
          <p className="mt-0.5 text-xs font-light text-dim">Model a scenario to plan ahead</p>
        </div>
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="text-sm font-medium transition-opacity hover:opacity-75"
          style={{ color: "var(--teal)" }}
        >
          {expanded ? "Collapse ▴" : "Expand ▾"}
        </button>
      </div>

      {/* Collapsible body */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: expanded ? "1200px" : "0",
          transition: "max-height 250ms ease-in-out",
        }}
      >
        <div
          className="px-6 pb-6 pt-5"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <ManualCalculator bare />
        </div>
      </div>
    </div>
  );
}
