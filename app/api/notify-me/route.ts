import type { NextRequest } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { isFeatureComingSoon } from "@/lib/launchConfig";

const resend = new Resend(process.env.RESEND_API_KEY!);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email, feature } = await req.json();

    if (
      typeof email !== "string" ||
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
    } = await supabase.auth.getUser();
    const user_id = user?.id ?? null;

    const adminClient = createServiceClient();
    const { error } = await adminClient
      .from("notify_me")
      .upsert(
        { email, feature, user_id },
        { onConflict: "email,feature", ignoreDuplicates: true }
      );

    if (error) throw error;

    try {
      await resend.emails.send({
        from: "Elidan AI <hello@elidan.ai>",
        to: "hello@elidan.ai",
        subject: `Notify me: ${feature}`,
        html: `
          <p>A user has requested
          notification for a coming
          soon feature.</p>
          <p><strong>Feature:</strong>
            ${feature}</p>
          <p><strong>Email:</strong>
            ${email}</p>
          <p><strong>User ID:</strong>
            ${user_id ?? "Not signed in"}</p>
          <p><strong>Time:</strong>
            ${new Date().toISOString()}</p>
        `,
      });
    } catch (resendError) {
      console.error("Resend notification failed:", resendError);
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("notify-me error:", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
