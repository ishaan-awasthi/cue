import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("waitlist")
    .insert({ email: email.trim().toLowerCase() });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "already_registered" }, { status: 409 });
    }
    console.error("Waitlist insert error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  try {
    await resend.emails.send({
      from: "Cue <hello@speakwithcue.com>",
      to: email,
      subject: "You're on the list.",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're on the Cue waitlist</title>
</head>
<body style="margin:0;padding:0;background:#0a0f0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f0d;padding:48px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;padding:0 24px;">
          <tr>
            <td style="padding-bottom:40px;">
              <span style="font-size:1.4rem;font-weight:900;letter-spacing:-0.04em;color:#2dffc0;">cue.</span>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid rgba(45,255,192,0.12);padding-top:36px;padding-bottom:28px;">
              <h1 style="margin:0 0 16px;font-size:2rem;font-weight:900;letter-spacing:-0.03em;line-height:1.1;color:#f0f5f3;">
                You're on the list.
              </h1>
              <p style="margin:0 0 24px;font-size:1rem;line-height:1.8;color:rgba(240,245,243,0.55);">
                Thanks for signing up — we'll reach out personally when your spot opens up. Cue is invite-only for now while we work through the hardware rollout.
              </p>
              <p style="margin:0;font-size:1rem;line-height:1.8;color:rgba(240,245,243,0.55);">
                In the meantime, if you have a demo or a pitch coming up that you'd like to use as a beta test, reply to this email and we'll do our best to get you in early.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:32px;border-top:1px solid rgba(45,255,192,0.08);">
              <p style="margin:0;font-size:0.78rem;color:rgba(240,245,243,0.22);">
                © ${new Date().getFullYear()} Cue. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    });
  } catch (emailErr) {
    // Don't fail the request if email send fails — user is already on the list
    console.error("Resend error:", emailErr);
  }

  return NextResponse.json({ ok: true });
}
