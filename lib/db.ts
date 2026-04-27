/**
 * Typed database query functions for Elidan AI.
 *
 * Rules:
 *   - Every function accepts userId explicitly — no global auth state.
 *   - Throws on unexpected errors; callers handle UI feedback.
 *
 * RLS note: functions that default to the browser (anon) client are subject
 * to Row Level Security via `auth.uid() = user_id`. Server route handlers
 * must pass the server SupabaseClient (from utils/supabase/server.ts) so the
 * authenticated session is present and RLS resolves correctly.
 */

import { supabase } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan, FeatureTier } from "./featureGates";
import type {
  BusinessProfile,
  BusinessProfileInsert,
  DataImport,
  DataImportInsert,
  DismissedAlert,
  ExpenseCategory,
  ExpenseCategoryInsert,
  FinancialMonth,
  FinancialMonthInsert,
  SnoozeType,
  UserAlertPreferences,
} from "./types";

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

// ─── Dismissed Alerts ─────────────────────────────────────────────────────────

/** Returns all active dismissal records for a user. */
export async function getDismissedAlerts(
  userId: string,
  client: SupabaseClient = supabase
): Promise<DismissedAlert[]> {
  const { data, error } = await client
    .from("dismissed_alerts")
    .select("*")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

/**
 * Upserts a dismissal record.
 * Re-dismissing an already-dismissed alert replaces the previous row
 * (same user_id + alert_code unique index).
 */
export async function dismissAlert(
  userId: string,
  payload: {
    alert_code: string;
    snooze_type: SnoozeType;
    snooze_until: string | null;
    data_version: string | null;
  },
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("dismissed_alerts")
    .upsert(
      {
        user_id: userId,
        alert_code: payload.alert_code,
        snooze_type: payload.snooze_type,
        snooze_until: payload.snooze_until,
        data_version: payload.data_version,
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,alert_code" }
    );

  if (error) throw error;
}

/** Removes a dismissal record, making the alert visible again. */
export async function undismissAlert(
  userId: string,
  alertCode: string,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("dismissed_alerts")
    .delete()
    .eq("user_id", userId)
    .eq("alert_code", alertCode);

  if (error) throw error;
}

// ─── Alert Preferences ────────────────────────────────────────────────────────

/**
 * Returns the user's snooze preference from business_profiles.
 * Falls back to '24h' if the column is null.
 */
export async function getAlertPreferences(
  userId: string,
  client: SupabaseClient = supabase
): Promise<UserAlertPreferences> {
  const { data, error } = await client
    .from("business_profiles")
    .select("snooze_duration")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const snooze = (data?.snooze_duration ?? "24h") as SnoozeType;
  return { snooze_duration: snooze };
}

/** Persists the snooze preference to business_profiles. */
export async function updateAlertPreferences(
  userId: string,
  prefs: UserAlertPreferences,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("business_profiles")
    .upsert(
      { user_id: userId, snooze_duration: prefs.snooze_duration },
      { onConflict: "user_id" }
    );

  if (error) throw error;
}

// ─── Subscriptions & Usage ────────────────────────────────────────────────────

export interface SubscriptionResult {
  plan: Plan;
  feature_tier: FeatureTier;
  status: string;
  founding_member_expires_at: string | null;
  founding_member_number: number | null;
}

const DEFAULT_STARTER: SubscriptionResult = {
  plan: "starter",
  feature_tier: "starter",
  status: "active",
  founding_member_expires_at: null,
  founding_member_number: null,
};

/**
 * Returns the user's subscription row, handling founding_member expiry.
 * Always call with the server client from utils/supabase/server.ts.
 */
export async function getSubscription(
  userId: string,
  client: SupabaseClient = supabase
): Promise<SubscriptionResult> {
  const { data, error } = await client
    .from("subscriptions")
    .select(
      "plan, feature_tier, status, founding_member_expires_at, founding_member_number"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_STARTER;

  const row = data as SubscriptionResult;

  if (
    row.plan === "founding_member" &&
    row.founding_member_expires_at !== null &&
    new Date() > new Date(row.founding_member_expires_at)
  ) {
    const { error: updateError } = await client
      .from("subscriptions")
      .update({ feature_tier: "starter" })
      .eq("user_id", userId);

    if (updateError) throw updateError;
    return { ...row, feature_tier: "starter" };
  }

  return row;
}

export interface UsageResult {
  count: number;
  usage_limit: number | null;
  warning_sent_at: string | null;
}

/**
 * Returns usage for a metric in the current billing period.
 * Always call with the server client from utils/supabase/server.ts.
 */
export async function getUsage(
  userId: string,
  metric: string,
  periodStart: Date,
  client: SupabaseClient = supabase
): Promise<UsageResult> {
  const { data, error } = await client
    .from("usage_tracking")
    .select("count, usage_limit, warning_sent_at")
    .eq("user_id", userId)
    .eq("metric", metric)
    .eq("period_start", periodStart.toISOString())
    .maybeSingle();

  if (error) throw error;
  if (!data) return { count: 0, usage_limit: null, warning_sent_at: null };

  return {
    count: data.count,
    usage_limit: data.usage_limit,
    warning_sent_at: data.warning_sent_at,
  };
}

/**
 * Atomically increments usage via a PostgreSQL RPC to avoid race conditions.
 * Requires the `increment_usage` function to exist in Supabase.
 * Always call with the server client from utils/supabase/server.ts.
 */
export async function incrementUsage(
  userId: string,
  metric: string,
  periodStart: Date,
  periodEnd: Date,
  usageLimit: number | null,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client.rpc("increment_usage", {
    p_user_id: userId,
    p_metric: metric,
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
    p_usage_limit: usageLimit,
  });

  if (error) throw error;
}

/**
 * Records that a usage warning email has been sent for this period.
 * Always call with the server client from utils/supabase/server.ts.
 */
export async function markWarningSent(
  userId: string,
  metric: string,
  periodStart: Date,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("usage_tracking")
    .update({ warning_sent_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("metric", metric)
    .eq("period_start", periodStart.toISOString());

  if (error) throw error;
}

/**
 * Returns the start of the current billing period (midnight UTC) based on
 * the day-of-month the subscription was originally created.
 *
 * Example: created on the 14th, today is the 20th of next month
 * → period start is the 14th of this month at 00:00 UTC.
 */
export function getBillingPeriodStart(subscriptionCreatedAt: Date): Date {
  const now = new Date();
  const createdDay = subscriptionCreatedAt.getUTCDate();

  const thisYear = now.getUTCFullYear();
  const thisMonth = now.getUTCMonth();

  // Clamp to the last day of the month in case the subscription day doesn't exist
  const daysInThisMonth = new Date(
    Date.UTC(thisYear, thisMonth + 1, 0)
  ).getUTCDate();
  const billingDayThisMonth = Math.min(createdDay, daysInThisMonth);

  if (now.getUTCDate() >= billingDayThisMonth) {
    return new Date(Date.UTC(thisYear, thisMonth, billingDayThisMonth));
  }

  // Period started last month
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
  const daysInLastMonth = new Date(
    Date.UTC(lastMonthYear, lastMonth + 1, 0)
  ).getUTCDate();
  const billingDayLastMonth = Math.min(createdDay, daysInLastMonth);

  return new Date(Date.UTC(lastMonthYear, lastMonth, billingDayLastMonth));
}
