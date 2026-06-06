"use client";

import { useState, useEffect } from "react";
import { calculateFinancials } from "@/lib/calculations";
import { isFeatureComingSoon } from "@/lib/launchConfig";
import type { FinancialSnapshot } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function runwayColor(months: number | null): string {
  if (months === null) return "#22C55E";
  if (months > 6) return "#22C55E";
  if (months >= 3) return "#F59E0B";
  return "#E84545";
}

function MiniStatCard({ label, value, valueColor = "#0A1A2F" }: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{
      backgroundColor: "#F4F7FA",
      border: "1px solid #D8E2EC",
      borderRadius: 10,
      padding: 12,
      minWidth: 0,
      overflow: "hidden",
    }}>
      <p style={{
        fontSize: 9,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "#6B7A8D",
        margin: "0 0 4px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        {label}
      </p>
      <p style={{
        fontSize: 16,
        fontWeight: 500,
        color: valueColor,
        margin: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        {value}
      </p>
    </div>
  );
}

function ResultsSection({ snapshot, onReset }: { snapshot: FinancialSnapshot; onReset: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const cashDisplay = formatCurrency(snapshot.cashPosition);
  const burnDisplay =
    snapshot.riskLevel === "Healthy" && snapshot.burnRate < 0
      ? `+${formatCurrency(Math.abs(snapshot.burnRate))}`
      : formatCurrency(snapshot.burnRate);
  const runwayDisplay =
    snapshot.runwayMonths !== null ? `${snapshot.runwayMonths.toFixed(1)} mo` : "Stable";
  const cashOutDisplay = snapshot.runoutDate ?? "Stable";

  return (
    <div style={{
      marginTop: 20,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(8px)",
      transition: "opacity 300ms ease-out, transform 300ms ease-out",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 8,
        width: "100%",
      }}>
        <MiniStatCard label="Cash Position" value={cashDisplay} />
        <MiniStatCard label="Monthly Burn" value={burnDisplay} />
        <MiniStatCard
          label="Runway"
          value={runwayDisplay}
          valueColor={runwayColor(snapshot.runwayMonths)}
        />
        <MiniStatCard label="Cash-Out Date" value={cashOutDisplay} />
      </div>
      <button
        type="button"
        onClick={onReset}
        style={{
          background: "none",
          border: "none",
          fontSize: 13,
          color: "#6B7A8D",
          cursor: "pointer",
          padding: "8px 0 0",
          display: "block",
        }}
      >
        Clear results
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
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

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "#6B7A8D",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  display: "block",
  marginBottom: 6,
};

function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "#2CA6A4";
  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(44,166,164,0.12)";
}

function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "#D8E2EC";
  e.currentTarget.style.boxShadow = "none";
}

export default function ManualCalculator({ bare = false }: { bare?: boolean }) {
  const [cash, setCash] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [calcKey, setCalcKey] = useState(0);
  const [validationError, setValidationError] = useState(false);

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();

    const cashValue = Number(cash);
    const revenueValue = Number(revenue);
    const expenseValue = Number(expenses);

    const valid =
      cash.trim() !== "" &&
      revenue.trim() !== "" &&
      expenses.trim() !== "" &&
      !Number.isNaN(cashValue) &&
      !Number.isNaN(revenueValue) &&
      !Number.isNaN(expenseValue) &&
      cashValue >= 0 &&
      revenueValue >= 0 &&
      expenseValue >= 0;

    if (!valid) {
      setValidationError(true);
      setSnapshot(null);
      return;
    }

    setValidationError(false);
    const result = calculateFinancials({
      cashBalance: cashValue,
      monthlyRevenue: revenueValue,
      monthlyExpenses: expenseValue,
    });
    setSnapshot(result);
    setCalcKey((k) => k + 1);
  }

  function handleReset() {
    setSnapshot(null);
    setCash("");
    setRevenue("");
    setExpenses("");
    setValidationError(false);
  }

  const form = (
    <form onSubmit={handleSubmit}>
      {/* Section A — Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label htmlFor="mc-cash" style={labelStyle}>Current cash balance</label>
          <input
            id="mc-cash"
            type="number"
            min="0"
            step="any"
            placeholder="50000"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            style={inputStyle}
            onFocus={focusInput}
            onBlur={blurInput}
          />
        </div>
        <div>
          <label htmlFor="mc-revenue" style={labelStyle}>Average monthly revenue</label>
          <input
            id="mc-revenue"
            type="number"
            min="0"
            step="any"
            placeholder="25000"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            style={inputStyle}
            onFocus={focusInput}
            onBlur={blurInput}
          />
        </div>
        <div>
          <label htmlFor="mc-expenses" style={labelStyle}>Average monthly expenses</label>
          <input
            id="mc-expenses"
            type="number"
            min="0"
            step="any"
            placeholder="30000"
            value={expenses}
            onChange={(e) => setExpenses(e.target.value)}
            style={inputStyle}
            onFocus={focusInput}
            onBlur={blurInput}
          />
        </div>
      </div>

      {validationError && (
        <p style={{ fontSize: 12, color: "#E84545", marginTop: 8, marginBottom: 0 }}>
          Please enter valid positive numbers in all three fields.
        </p>
      )}

      <button
        type="submit"
        style={{
          width: "100%",
          height: 44,
          backgroundColor: "#2CA6A4",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
          marginTop: 16,
        }}
      >
        Calculate My Runway →
      </button>
    </form>
  );

  const resultsSection = snapshot ? (
    <ResultsSection key={calcKey} snapshot={snapshot} onReset={handleReset} />
  ) : null;

  if (bare) {
    return (
      <div>
        {form}
        {resultsSection}
      </div>
    );
  }

  return (
    <section
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid #D8E2EC",
        boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
        padding: 24,
        maxWidth: 640,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 500, color: "#0A1A2F", margin: "0 0 4px" }}>
        What-If Scenario
      </h2>
      <p style={{ fontSize: 13, color: "#6B7A8D", margin: "0 0 20px" }}>
        Enter numbers manually to explore scenarios.
      </p>
      {form}
      {resultsSection}
    </section>
  );
}
