import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { attachAdminCaptchaCookie, createAdminCaptcha } from "@/lib/admin-captcha";

export async function GET(request: Request) {
  const limit = await rateLimit(request, "admin-captcha", 30, 60);
  if (!limit.allowed) return NextResponse.json({ error: "Please wait before requesting another security code." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "no-store" } });
  if (!process.env.SESSION_SECRET) return NextResponse.json({ error: "Set SESSION_SECRET in .env.local before enabling accounts." }, { status: 503 });
  const captcha = createAdminCaptcha();
  const response = NextResponse.json({ code: captcha.answer }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  return attachAdminCaptchaCookie(response, captcha.token);
}
