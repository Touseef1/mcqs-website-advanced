import { NextResponse } from "next/server";
import { attachLearnerCaptchaCookie, createLearnerCaptcha } from "@/lib/learner-captcha";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limit = await rateLimit(request, "learner-captcha", 30, 60);
  if (!limit.allowed) return NextResponse.json({ error: "Please wait before requesting another security code." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "no-store" } });
  if (!process.env.SESSION_SECRET) return NextResponse.json({ error: "Set SESSION_SECRET in .env.local before enabling accounts." }, { status: 503 });
  const captcha = createLearnerCaptcha();
  const response = NextResponse.json({ code: captcha.answer }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  return attachLearnerCaptchaCookie(response, captcha.token);
}
