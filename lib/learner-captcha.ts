import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const CAPTCHA_TTL_SECONDS = 5 * 60;

type CaptchaPayload = { answer: string; expiresAt: number };
const LEARNER_COOKIE_NAME = "mcqpath_learner_captcha";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not configured.");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createNumericCaptcha() {
  const answer = String(randomInt(1000, 10000));
  const payload = Buffer.from(JSON.stringify({ answer, expiresAt: Date.now() + CAPTCHA_TTL_SECONDS * 1000 } satisfies CaptchaPayload)).toString("base64url");
  return { answer, token: `${payload}.${sign(payload)}` };
}

export function attachNumericCaptchaCookie(response: NextResponse, token: string, cookieName: string, path: string) {
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path,
    maxAge: CAPTCHA_TTL_SECONDS,
  });
  return response;
}

export function clearNumericCaptchaCookie(response: NextResponse, cookieName: string, path: string) {
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path,
    maxAge: 0,
  });
  return response;
}

export function verifyNumericCaptcha(request: Request, answer: unknown, cookieName: string) {
  if (typeof answer !== "string" || !/^\d{4}$/.test(answer)) return false;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return false;
  const [payload, signature] = decodeURIComponent(token).split(".");
  if (!payload || !signature) return false;
  try {
    const expected = Buffer.from(sign(payload));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    const challenge = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CaptchaPayload;
    const expectedAnswer = Buffer.from(challenge.answer);
    const suppliedAnswer = Buffer.from(answer);
    return /^\d{4}$/.test(challenge.answer)
      && Number.isFinite(challenge.expiresAt)
      && challenge.expiresAt >= Date.now()
      && expectedAnswer.length === suppliedAnswer.length
      && timingSafeEqual(expectedAnswer, suppliedAnswer);
  } catch {
    return false;
  }
}

export const createLearnerCaptcha = createNumericCaptcha;
export function attachLearnerCaptchaCookie(response: NextResponse, token: string) {
  return attachNumericCaptchaCookie(response, token, LEARNER_COOKIE_NAME, "/api/learner");
}
export function clearLearnerCaptchaCookie(response: NextResponse) {
  return clearNumericCaptchaCookie(response, LEARNER_COOKIE_NAME, "/api/learner");
}
export function verifyLearnerCaptcha(request: Request, answer: unknown) {
  return verifyNumericCaptcha(request, answer, LEARNER_COOKIE_NAME);
}

