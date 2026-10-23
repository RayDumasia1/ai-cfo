import type { NextRequest } from "next/server";
import { escapeHtml, sendEmail } from "@/lib/emailDelivery";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { isFeatureComingSoon } from "@/lib/launchConfig";

const EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const { email: rawEmail, feature } = body as Record<string, unknown>;
    const email = typeof rawEmail === "string" ? rawEmail.trim() : rawEmail;

    if (
      typeof email !== "string" ||
      email.length > 254 ||
      !EMAIL_REGEX.test(email) ||
      typeof feature !== "string" ||
      feature.trim().length === 0 ||
      !isFeatureComingSoon(feature)
    ) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    const user_id = authError ? null : user?.id ?? null;

    const adminClient = createServiceClient();
    const { data: inserted, error } = await adminClient
      .from("notify_me")
      .upsert(
        { email, feature, user_id },
        { onConflict: "email,feature", ignoreDuplicates: true }
      )
      .select("email")
      .maybeSingle();

    if (error) throw error;

    // Only new registrations notify support; duplicates remain successful.
    if (inserted) {
      await sendEmail({
        from: "Elidan AI <hello@elidan.ai>",
        to: "hello@elidan.ai",
        subject: `Notify me: ${feature}`,
        html: `
          <p>A user has requested
          notification for a coming
          soon feature.</p>
          <p><strong>Feature:</strong>
            ${escapeHtml(feature)}</p>
          <p><strong>Email:</strong>
            ${escapeHtml(email)}</p>
          <p><strong>User ID:</strong>
            ${escapeHtml(user_id ?? "Not signed in")}</p>
          <p><strong>Time:</strong>
            ${new Date().toISOString()}</p>
        `,
      }, "notify_me");
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("notify-me:error", { reason: err instanceof Error ? "request_exception" : "database_error" });
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
