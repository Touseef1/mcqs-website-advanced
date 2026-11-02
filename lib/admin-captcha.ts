import { NextResponse } from "next/server";
import { attachNumericCaptchaCookie, clearNumericCaptchaCookie, createNumericCaptcha, verifyNumericCaptcha } from "@/lib/learner-captcha";

const COOKIE_NAME = "mcqpath_admin_captcha";
const COOKIE_PATH = "/api/admin";

export const createAdminCaptcha = createNumericCaptcha;
export function attachAdminCaptchaCookie(response: NextResponse, token: string) {
  return attachNumericCaptchaCookie(response, token, COOKIE_NAME, COOKIE_PATH);
}
export function clearAdminCaptchaCookie(response: NextResponse) {
  return clearNumericCaptchaCookie(response, COOKIE_NAME, COOKIE_PATH);
}
export function verifyAdminCaptcha(request: Request, answer: unknown) {
  return verifyNumericCaptcha(request, answer, COOKIE_NAME);
}
