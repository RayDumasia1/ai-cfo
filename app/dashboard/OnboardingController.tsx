"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WelcomeBanner from "@/app/components/onboarding/WelcomeBanner";
import OnboardingModal from "@/app/components/onboarding/OnboardingModal";
import CelebrationBanner from "@/app/components/onboarding/CelebrationBanner";

interface OnboardingControllerProps {
  /** Server-derived: no data, onboarding not completed, not a superuser. */
  isNewUser: boolean;
  businessName: string | null;
  /** Runway from current data — refreshed by router.refresh() after import. */
  currentRunway: number | null;
}

const TOAST_MS = 4000;

async function markOnboardingComplete() {
  try {
    const res = await fetch("/api/onboarding", { method: "POST" });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    // Non-blocking: worst case the banner reappears on the next visit.
    console.error("onboarding:complete:failed", err);
  }
}

/**
 * Welcome banner → 4-step modal → celebration banner.
 * Stays mounted across router.refresh() so client state survives the
 * dashboard reloading its data after import.
 */
export default function OnboardingController({
  isNewUser,
  businessName,
  currentRunway,
}: OnboardingControllerProps) {
  const router = useRouter();
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(isNewUser);
  const [showModal, setShowModal] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showToast, setShowToast] = useState(false);
  // Name saved in modal step 1, shown before the server data refreshes.
  const [savedName, setSavedName] = useState<string | null>(null);
  const displayName = savedName ?? businessName;

  useEffect(() => {
    if (!showToast) return;
    const t = setTimeout(() => setShowToast(false), TOAST_MS);
    return () => clearTimeout(t);
  }, [showToast]);

  async function handleBannerDismiss() {
    setShowWelcomeBanner(false);
    await markOnboardingComplete();
    router.refresh();
  }

  async function handleOnboardingComplete() {
    setShowModal(false);
    setShowWelcomeBanner(false);
    setShowCelebration(true);
    await markOnboardingComplete();
    router.refresh();
  }

  function handleCelebrationDismiss() {
    setShowCelebration(false);
    // Idempotent — ensures completion is recorded even if the earlier call failed.
    void markOnboardingComplete();
  }

  function handleNeedMoreTime() {
    setShowModal(false);
    setShowToast(true);
  }

  return (
    <>
      {showCelebration ? (
        <CelebrationBanner
          businessName={displayName}
          currentRunway={currentRunway}
          onDismiss={handleCelebrationDismiss}
        />
      ) : showWelcomeBanner ? (
        <WelcomeBanner
          businessName={displayName}
          onGetStarted={() => setShowModal(true)}
          onDismiss={handleBannerDismiss}
        />
      ) : null}

      {showModal && (
        <OnboardingModal
          businessName={displayName}
          onComplete={handleOnboardingComplete}
          onClose={() => setShowModal(false)}
          onNeedMoreTime={handleNeedMoreTime}
          onBusinessNameSaved={(name) => {
            setSavedName(name);
            router.refresh();
          }}
        />
      )}

      {showToast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 w-[calc(100vw-32px)] max-w-[420px] -translate-x-1/2 bg-navy px-5 py-3.5 text-sm text-white"
          style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
        >
          No problem — the Import button on your dashboard is ready whenever you are.
        </div>
      )}
    </>
  );
}
