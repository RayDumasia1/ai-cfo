/**
 * Parses the comma-separated SUPERUSER_EMAILS env var into lowercase emails.
 */
export function parseSuperuserEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A user sees onboarding when they have no imported data, have never
 * completed or dismissed onboarding, and are not a superuser.
 *
 * Unlike featureGates.isSuperuser, the superuser check applies in every
 * environment — superusers never see onboarding.
 */
export function isNewUser({
  monthsCount,
  onboardingCompletedAt,
  email,
  superuserEmails,
}: {
  monthsCount: number;
  onboardingCompletedAt: string | null | undefined;
  email: string | null | undefined;
  superuserEmails: string[];
}): boolean {
  const isSuperuser =
    !!email && superuserEmails.includes(email.trim().toLowerCase());
  return monthsCount === 0 && !onboardingCompletedAt && !isSuperuser;
}
