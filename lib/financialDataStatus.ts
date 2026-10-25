import type { DataImport } from "./types";

export interface FinancialImportStatus {
  available: boolean;
  lastImportedAt: string | null;
  filename: string | null;
}

export type FinancialImportHistoryItem = Pick<DataImport,
  "id" | "import_type" | "filename" | "months_imported" | "status" | "created_at">;

export interface FinancialImportHistory {
  available: boolean;
  imports: FinancialImportHistoryItem[];
}

export interface FinancialDataProvenanceMonth {
  month_date: string;
  data_contract_version: 1 | 2;
  source_type: "legacy_spreadsheet" | "spreadsheet" | "quickbooks" | "manual" | "other";
  accounting_basis: "cash" | "accrual" | "mixed" | "unknown" | null;
  reporting_currency: string | null;
  period_status: "complete" | "partial" | "unknown";
  period_cutoff_date: string | null;
}

export function financialDataProvenance(months: FinancialDataProvenanceMonth[]) {
  const ordered = [...months].sort((a,b)=>a.month_date.localeCompare(b.month_date));
  const unique = <T,>(values:T[]) => [...new Set(values)];
  return {
    firstMonth: ordered[0]?.month_date ?? null,
    latestMonth: ordered.at(-1)?.month_date ?? null,
    latestPeriodStatus: ordered.at(-1)?.period_status ?? null,
    latestPeriodCutoff: ordered.at(-1)?.period_cutoff_date ?? null,
    storedMonths: ordered.length,
    sourceTypes: unique(ordered.map(month=>month.source_type)),
    contractVersions: unique(ordered.map(month=>month.data_contract_version)),
    accountingBases: unique(ordered.map(month=>month.accounting_basis).filter(value=>value !== null)),
    reportingCurrencies: unique(ordered.map(month=>month.reporting_currency).filter(value=>value !== null)),
  };
}

/** Coverage of the displayed stored records; it does not infer missing values as zero. */
export function financialDataCoverage(months: string[]) {
  const dates = [...new Set(months)].sort();
  const index = (date: string) => Number(date.slice(0,4)) * 12 + Number(date.slice(5,7)) - 1;
  const missing: string[] = [];
  if (dates.length > 1) {
    const existing = new Set(dates.map(index));
    for (let month = index(dates[0]) + 1; month < index(dates[dates.length - 1]); month++) {
      if (!existing.has(month)) missing.push(`${String(Math.floor(month/12)).padStart(4,"0")}-${String(month%12+1).padStart(2,"0")}-01`);
    }
  }
  return {latestMonth: dates.at(-1) ?? null, missingMonths: missing};
}

export function financialMonthLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
}
