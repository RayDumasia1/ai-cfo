import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildImportReview, importReviewAction } from "../lib/financialImportReview";
import { importFileHash, issueImportReviewToken, verifyImportReviewToken, IMPORT_REVIEW_TTL_SECONDS } from "../lib/financialImportReviewToken";

const current = Array.from({length:12},(_,i) => "2025-" + String(i+1).padStart(2,"0") + "-01");
const state = { state_version:"a".repeat(32), months:current };
const hash = importFileHash(new TextEncoder().encode("synthetic workbook").buffer);
const identity = { userId:"own-user",mode:"update_months" as const,filename:"import.xlsx",fileHash:hash };
const now = 1000000;
beforeEach(() => vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","synthetic-import-review-test-key"));
afterEach(() => vi.unstubAllEnvs());

describe("financial import review effects", () => {
  it("adds historical months while keeping the current latest month and identifying hidden months", () => {
    const incoming = ["2024-02-01","2024-01-01"];
    const review = buildImportReview("history.xlsx","update_months",incoming,state,[]);
    expect(review).toMatchObject({addedMonths:["2024-01-01","2024-02-01"],updatedMonths:[],removedMonths:[],
      resultingMonthsTotal:14,resultingLatestMonth:"2025-12-01",currentLatestMonth:"2025-12-01",
      outsideDashboardMonths:["2024-01-01","2024-02-01"]});
    expect(importReviewAction(review)).toBe("Add 2 months");
    expect(incoming).toEqual(["2024-02-01","2024-01-01"]);
    expect(state.months).toEqual(current);
  });
  it("distinguishes existing-month corrections from new and future months", () => {
    const review = buildImportReview("mixed.xlsx","update_months",["2025-02-01","2026-01-01"],state,[]);
    expect(review).toMatchObject({addedMonths:["2026-01-01"],updatedMonths:["2025-02-01"],removedMonths:[],
      olderMonths:["2025-02-01"],resultingLatestMonth:"2026-01-01",resultingMonthsTotal:13});
    expect(importReviewAction(review)).toBe("Import 2 months");
  });
  it("does not label the latest existing month as older data", () => {
    const review = buildImportReview("correction.xlsx","update_months",["2025-12-01"],state,[]);
    expect(review.olderMonths).toEqual([]);
    expect(importReviewAction(review)).toBe("Update 1 month");
  });
  it("keeps months seven through twelve visible and moves the window when a newer month is added", () => {
    const correction = buildImportReview("correction.xlsx","update_months",["2025-01-01"],state,[]);
    expect(correction.dashboardMonthsLimit).toBe(12);
    expect(correction.outsideDashboardMonths).toEqual([]);
    const extended = buildImportReview("extended.xlsx","update_months",["2025-01-01","2026-01-01"],state,[]);
    expect(extended.outsideDashboardMonths).toEqual(["2025-01-01"]);
    expect(extended.resultingLatestMonth).toBe("2026-01-01");
  });
  it("lists removed newer months when replacing with historical data", () => {
    const review = buildImportReview("older.xlsx","replace_all",["2024-01-01"],state,[]);
    expect(review.removedMonths).toEqual(current);
    expect(review.resultingLatestMonth).toBe("2024-01-01");
    expect(review.outsideDashboardMonths).toEqual([]);
    expect(importReviewAction(review)).toBe("Replace all data with 1 month");
  });
  it("supports first upload, gaps, and overlapping replacements", () => {
    const initial = buildImportReview("first.xlsx","update_months",["2024-01-01","2024-08-01"],{state_version:state.state_version,months:[]},[]);
    expect(initial).toMatchObject({currentLatestMonth:null,olderMonths:[],resultingMonthsTotal:2,outsideDashboardMonths:[]});
    const replacement = buildImportReview("overlap.xlsx","replace_all",["2025-12-01","2026-02-01"],state,[]);
    expect(replacement.updatedMonths).toEqual(["2025-12-01"]);
    expect(replacement.removedMonths).toHaveLength(11);
    expect(replacement.resultingMonthsTotal).toBe(2);
  });
});

describe("missing calendar months in upload reviews", () => {
  const withoutMarch = current.filter(date => date !== "2025-03-01");
  const empty = { state_version: state.state_version, months: [] };

  it("identifies a missing month in an eleven-month file and keeps saved values in update mode", () => {
    const review = buildImportReview("eleven.xlsx", "update_months", withoutMarch, state, []);
    expect(review.warnings).toContain("Missing from this file: March 2025. Your saved data for these months will be kept.");
    expect(review.resultingMonthsTotal).toBe(12);
    expect(review.removedMonths).toEqual([]);
    expect(importReviewAction(review)).toBe("Update 11 months");
  });

  it.each(["update_months", "replace_all"] as const)("explains gaps without saved data in %s", mode => {
    const review = buildImportReview("eleven.xlsx", mode, withoutMarch, empty, []);
    expect(review.warnings).toContain("Missing from this file: March 2025. No saved data exists for these months; your financial timeline will contain gaps. Missing values will not be filled with zero.");
    expect(review.resultingMonthsTotal).toBe(11);
    expect(review.incomingMonths).not.toContain("2025-03-01");
  });

  it("explicitly warns when Replace all will remove a saved internal month", () => {
    const review = buildImportReview("eleven.xlsx", "replace_all", withoutMarch, state, []);
    expect(review.warnings).toContain("Missing from this file: March 2025. Your saved data for these months will be removed because Replace all is selected.");
    expect(review.removedMonths).toEqual(["2025-03-01"]);
    expect(review.resultingMonthsTotal).toBe(11);
  });

  it.each([current, current.slice(0,6), ["2025-03-01"], ["2024-12-01","2025-01-01"]].map(dates => ({dates})))(
    "does not invent missing months outside a contiguous file range: $dates", ({dates}) => {
      expect(buildImportReview("partial.xlsx", "update_months", dates, state, []).warnings).toEqual([]);
    });

  it("groups consecutive cross-year gaps and distinguishes kept data from missing data", () => {
    const warnings = ["Existing parser warning"];
    const review = buildImportReview("mixed.xlsx", "update_months", ["2025-03-01","2024-10-01"],
      { ...state, months: ["2024-11-01","2024-12-01","2025-02-01"] }, warnings);
    expect(review.warnings).toContain("Missing from this file: November 2024–December 2024, February 2025. Your saved data for these months will be kept.");
    expect(review.warnings).toContain("Missing from this file: January 2025. No saved data exists for these months; your financial timeline will contain gaps. Missing values will not be filled with zero.");
    expect(review.warnings[0]).toBe("Existing parser warning");
    expect(warnings).toEqual(["Existing parser warning"]);
    expect(review.warnings.at(-1)).toBe("You can continue with this upload, or cancel and correct the workbook.");
  });
});

describe("account/file/mode-bound expiring review tokens", () => {
  it("retains the reviewed state and accepts a valid token until expiration", () => {
    const token = issueImportReviewToken(identity,state.state_version,now);
    expect(verifyImportReviewToken(token,identity,now)).toBe(state.state_version);
    expect(verifyImportReviewToken(token,identity,now + IMPORT_REVIEW_TTL_SECONDS*1000-1)).toBe(state.state_version);
    expect(verifyImportReviewToken(token,identity,now + IMPORT_REVIEW_TTL_SECONDS*1000)).toBeNull();
  });
  it.each([
    {userId:"other-user"},{mode:"replace_all" as const},{filename:"other.xlsx"},{fileHash:"b".repeat(64)},
  ])("rejects a different identity: %j", change => {
    const token = issueImportReviewToken(identity,state.state_version,now);
    expect(verifyImportReviewToken(token,{...identity,...change},now)).toBeNull();
  });
  it("rejects tampered claims even when they are still valid JSON", () => {
    const token = issueImportReviewToken(identity,state.state_version,now);
    const [encoded,signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
    claims.stateVersion = "b".repeat(32);
    const tampered = Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + signature;
    expect(verifyImportReviewToken(tampered,identity,now)).toBeNull();
  });
  it.each(["","no-signature","bad.bad","a."+"a".repeat(63),"x".repeat(17000)])("rejects malformed token: %s", token => {
    expect(verifyImportReviewToken(token,identity,now)).toBeNull();
  });
  it("rejects a token after signing-key rotation without exposing either key", () => {
    const token = issueImportReviewToken(identity,state.state_version,now);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","different-synthetic-test-key");
    expect(verifyImportReviewToken(token,identity,now)).toBeNull();
  });
  it("hashes exact bytes, including file changes with the same filename", () => {
    expect(importFileHash(new TextEncoder().encode("synthetic workbook ").buffer)).not.toBe(hash);
  });
});
