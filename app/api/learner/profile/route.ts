import { NextResponse } from "next/server";
import { getLearnerPrincipal } from "@/lib/learner-auth";

export async function GET() {
  const learner = await getLearnerPrincipal();
  return NextResponse.json(
    { learner: learner ? { id: learner.id, name: learner.name } : null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
