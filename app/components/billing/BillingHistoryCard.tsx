"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";

interface Invoice {
  id: string;
  number: string | null;
  amount_paid: number;
  currency: string;
  status: string | null;
  created: number;
  invoice_pdf: string | null;
  hosted_invoice_url: string | null;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  paid: { bg: "rgba(44,166,164,0.10)", color: "#2CA6A4", label: "Paid" },
  open: { bg: "rgba(217,119,6,0.10)", color: "#B45309", label: "Open" },
  void: { bg: "#F4F7FA", color: "#6B7A8D", label: "Void" },
  draft: { bg: "#F4F7FA", color: "#6B7A8D", label: "Draft" },
};

function currencySymbol(currency: string) {
  return currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase() + " ";
}

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} style={{ padding: "12px 8px" }}>
          <div
            style={{
              height: 12,
              width: i === 5 ? 60 : i === 1 ? 100 : 80,
              backgroundColor: "#D8E2EC",
              borderRadius: 4,
            }}
          />
        </td>
      ))}
    </tr>
  );
}

export default function BillingHistoryCard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing/invoices")
      .then((r) => r.json())
      .then((data) => {
        setInvoices(data.invoices ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <section
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #D8E2EC",
        borderRadius: 16,
        boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
        padding: 24,
      }}
    >
      <h2
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "#0A1A2F",
          margin: "0 0 16px",
        }}
      >
        Billing history
      </h2>

      {loading ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </tbody>
        </table>
      ) : invoices.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6B7A8D", margin: 0 }}>
          No billing history yet.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid #D8E2EC",
                  textAlign: "left",
                }}
              >
                {["Date", "Invoice", "Amount", "Status", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "0 8px 10px",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "#6B7A8D",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const statusInfo = STATUS_STYLE[inv.status ?? ""] ?? STATUS_STYLE.void;
                return (
                  <tr
                    key={inv.id}
                    style={{ borderBottom: "1px solid #F4F7FA" }}
                  >
                    <td style={{ padding: "12px 8px", color: "#344150" }}>
                      {new Date(inv.created * 1000).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td style={{ padding: "12px 8px", color: "#6B7A8D" }}>
                      {inv.number ?? inv.id.slice(0, 12) + "..."}
                    </td>
                    <td style={{ padding: "12px 8px", color: "#344150", fontWeight: 500 }}>
                      {currencySymbol(inv.currency)}
                      {(inv.amount_paid / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 500,
                          backgroundColor: statusInfo.bg,
                          color: statusInfo.color,
                        }}
                      >
                        {statusInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        {inv.invoice_pdf && (
                          <a
                            href={inv.invoice_pdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 12,
                              color: "#2CA6A4",
                              textDecoration: "none",
                            }}
                          >
                            <FileText size={12} />
                            PDF
                          </a>
                        )}
                        {inv.hosted_invoice_url && (
                          <a
                            href={inv.hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 12,
                              color: "#6B7A8D",
                              textDecoration: "none",
                            }}
                          >
                            <ExternalLink size={12} />
                            View
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
