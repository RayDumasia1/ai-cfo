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

  function fetchSubscription() {
    setLoading(true);
    setError(null);
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
  }

  useEffect(() => {
    fetchSubscription();
  }, []);

  return { subscription, loading, error, refetch: fetchSubscription };
}

export function useUsageFromHeaders(headers: Headers) {
  const used = headers.get("X-Usage-Used");
  const limit = headers.get("X-Usage-Limit");
  const throttled = headers.get("X-Usage-Throttled");
  return {
    used: used != null ? parseInt(used, 10) : null,
    limit: limit === "unlimited" ? null : limit != null ? parseInt(limit, 10) : null,
    throttled: throttled === "true",
  };
}
