/**
 * Typed database query functions for Elidan AI.
 *
 * Rules:
 *   - Every function accepts userId explicitly — no global auth state.
 *   - Throws on unexpected errors; callers handle UI feedback.
 *   - When auth is wired up, replace TEST_USER_ID with the real session uid.
 *
 * RLS note: functions that default to the browser (anon) client are subject
 * to Row Level Security via `auth.uid() = user_id`. Server route handlers
 * must pass the server SupabaseClient (from utils/supabase/server.ts) so the
 * authenticated session is present and RLS resolves correctly.
 */

import { supabase } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessProfile,
  BusinessProfileInsert,
  DataImport,
  DataImportInsert,
  ExpenseCategory,
  ExpenseCategoryInsert,
  FinancialMonth,
  FinancialMonthInsert,
} from "./types";

// ─── Test constant ────────────────────────────────────────────────────────────
// TODO: Replace with `(await supabase.auth.getUser()).data.user?.id` once auth
// is set up. Pass this into each function from the component/page.
export const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

// ─── Business Profile ─────────────────────────────────────────────────────────

/** Returns null if no profile exists yet for this user. */
export async function getBusinessProfile(
  userId: string
): Promise<BusinessProfile | null> {
  const { data, error } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Creates or updates the profile for a user.
 * Safe to call on every save — upserts on the unique user_id constraint.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function upsertBusinessProfile(
  userId: string,
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>,
  client: SupabaseClient = supabase
): Promise<BusinessProfile> {
  const { data, error } = await client
    .from("business_profiles")
    .upsert({ ...profile, user_id: userId }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Financial Months ─────────────────────────────────────────────────────────

/**
 * Returns months ordered newest-first.
 * Default limit of 12 covers a trailing-year view.
 */
export async function getFinancialMonths(
  userId: string,
  limit = 12,
  client: SupabaseClient = supabase
): Promise<FinancialMonth[]> {
  const { data, error } = await client
    .from("financial_months")
    .select("*")
    .eq("user_id", userId)
    .order("month_date", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates or updates a single month.
 * Upserts on the unique (user_id, month_date) constraint.
 */
export async function upsertFinancialMonth(
  userId: string,
  monthData: Omit<FinancialMonthInsert, "user_id">
): Promise<FinancialMonth> {
  const { data, error } = await supabase
    .from("financial_months")
    .upsert(
      { ...monthData, user_id: userId },
      { onConflict: "user_id,month_date" }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Bulk upsert — used when importing from Excel / CSV.
 * Each row upserts on (user_id, month_date), so re-importing the same
 * file is safe and idempotent.
 */
export async function upsertFinancialMonths(
  userId: string,
  months: Omit<FinancialMonthInsert, "user_id">[],
  client: SupabaseClient = supabase
): Promise<FinancialMonth[]> {
  if (months.length === 0) return [];

  const { data, error } = await client
    .from("financial_months")
    .upsert(
      months.map((m) => ({ ...m, user_id: userId })),
      { onConflict: "user_id,month_date" }
    )
    .select();

  if (error) throw error;
  return data ?? [];
}

// ─── Expense Categories ───────────────────────────────────────────────────────

/**
 * Returns expense categories, newest month first.
 * Pass monthDate ("YYYY-MM-DD") to filter to a single month.
 */
export async function getExpenseCategories(
  userId: string,
  monthDate?: string
): Promise<ExpenseCategory[]> {
  let query = supabase
    .from("expense_categories")
    .select("*")
    .eq("user_id", userId)
    .order("month_date", { ascending: false });

  if (monthDate) {
    query = query.eq("month_date", monthDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Upserts expense categories in bulk.
 * Uses replace semantics per month: deletes existing categories for each
 * affected month_date before inserting the new set. This keeps the data
 * consistent when re-importing a month.
 */
export async function upsertExpenseCategories(
  userId: string,
  categories: Omit<ExpenseCategoryInsert, "user_id">[]
): Promise<ExpenseCategory[]> {
  if (categories.length === 0) return [];

  // Collect the distinct month dates touched by this batch
  const monthDates = [...new Set(categories.map((c) => c.month_date))];

  // Delete existing rows for those months (replace semantics)
  const { error: deleteError } = await supabase
    .from("expense_categories")
    .delete()
    .eq("user_id", userId)
    .in("month_date", monthDates);

  if (deleteError) throw deleteError;

  // Insert the new set
  const { data, error } = await supabase
    .from("expense_categories")
    .insert(categories.map((c) => ({ ...c, user_id: userId })))
    .select();

  if (error) throw error;
  return data ?? [];
}

// ─── Data Imports ─────────────────────────────────────────────────────────────

/**
 * Records a completed (or failed) import run for audit purposes.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function logDataImport(
  userId: string,
  importData: Omit<DataImportInsert, "user_id">,
  client: SupabaseClient = supabase
): Promise<DataImport> {
  const { data, error } = await client
    .from("data_imports")
    .insert({ ...importData, user_id: userId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Composite helpers ────────────────────────────────────────────────────────

/**
 * Returns the existing business profile for the user, or creates a default one
 * if none exists yet. Safe to call on every dashboard load.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function getOrCreateBusinessProfile(
  userId: string,
  client: SupabaseClient = supabase
): Promise<BusinessProfile> {
  const { data: existing, error: fetchError } = await client
    .from("business_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data, error } = await client
    .from("business_profiles")
    .upsert({ user_id: userId }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export interface CashPositionResult {
  /** Closing cash of the most recent month. */
  cash: number;
  /** ISO date of the most recent month, e.g. "2026-04-01". */
  month: string;
  /** Closing cash of the previous month, null if only one month exists. */
  previousCash: number | null;
}

/**
 * Returns the cash position from the two most recent financial months.
 * Returns null if no data has been imported yet.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function getCurrentCashPosition(
  userId: string,
  client: SupabaseClient = supabase
): Promise<CashPositionResult | null> {
  const { data, error } = await client
    .from("financial_months")
    .select("closing_cash, month_date")
    .eq("user_id", userId)
    .order("month_date", { ascending: false })
    .limit(2);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  return {
    cash: data[0].closing_cash ?? 0,
    month: data[0].month_date,
    previousCash: data[1]?.closing_cash ?? null,
  };
}
