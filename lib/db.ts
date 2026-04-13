/**
 * Typed database query functions for Elidan AI.
 *
 * Rules:
 *   - Every function accepts userId explicitly — no global auth state.
 *   - Throws on unexpected errors; callers handle UI feedback.
 *   - When auth is wired up, replace TEST_USER_ID with the real session uid.
 *
 * ⚠️  RLS note: these functions use the browser (anon) client, which is
 * subject to Row Level Security. Until auth is set up, queries will be
 * blocked by the `auth.uid() = user_id` policies. To test locally before
 * auth is ready, temporarily disable RLS on the target table in the
 * Supabase dashboard (Table Editor → RLS → Disable), then re-enable it
 * once auth is integrated.
 */

import { supabase } from "./supabase";
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
 */
export async function upsertBusinessProfile(
  userId: string,
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>
): Promise<BusinessProfile> {
  const { data, error } = await supabase
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
  limit = 12
): Promise<FinancialMonth[]> {
  const { data, error } = await supabase
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
  months: Omit<FinancialMonthInsert, "user_id">[]
): Promise<FinancialMonth[]> {
  if (months.length === 0) return [];

  const { data, error } = await supabase
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
 */
export async function logDataImport(
  userId: string,
  importData: Omit<DataImportInsert, "user_id">
): Promise<DataImport> {
  const { data, error } = await supabase
    .from("data_imports")
    .insert({ ...importData, user_id: userId })
    .select()
    .single();

  if (error) throw error;
  return data;
}
