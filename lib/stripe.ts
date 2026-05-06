import "server-only";
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

export const STRIPE_PRICES: Record<string, string> = {
  starter:         process.env.STRIPE_PRICE_STARTER!,
  core:            process.env.STRIPE_PRICE_CORE!,
  growth:          process.env.STRIPE_PRICE_GROWTH!,
  advisory:        process.env.STRIPE_PRICE_ADVISORY!,
  founding_member: process.env.STRIPE_PRICE_FOUNDING!,
  cfo_call:        process.env.STRIPE_PRICE_CFO_CALL!,
};

// founding_member gets core feature access (NOT advisory)
export const PLAN_TO_TIER: Record<string, string> = {
  starter:         "starter",
  core:            "core",
  growth:          "growth",
  advisory:        "advisory",
  founding_member: "core",
};
