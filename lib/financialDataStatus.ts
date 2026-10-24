export interface FinancialImportStatus {
  available: boolean;
  lastImportedAt: string | null;
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
