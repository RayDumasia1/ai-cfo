"use client";

import { useState, useEffect } from "react";
import type { Plan, FeatureTier } from "@/lib/featureGates";

export interface SubscriptionData {
  plan: Plan;
  feature_tier: FeatureTier;
  status: string;
  founding_member_number: number | null;
  founding_member_expires_at: string | null;
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => r.json())
      .then((data) => {
        setSubscription(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { subscription, loading, error };
}
