import type { FeatureTier } from "@/lib/featureGates";
import CfoCallButton from "./CfoCallButton";

interface CfoCallCardProps {
  tier: FeatureTier;
  email: string;
}

export default function CfoCallCard({ tier, email }: CfoCallCardProps) {
  return <CfoCallButton userTier={tier} userEmail={email} />;
}
