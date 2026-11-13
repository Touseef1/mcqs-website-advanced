"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";

type LearnerHeaderState = { name: string } | null;

export function LearnerHeaderAccount() {
  const [learner, setLearner] = useState<LearnerHeaderState>(null);

  useEffect(() => {
    let active = true;
    const loadLearner = async () => {
      try {
        const response = await fetch("/api/learner/profile", { cache: "no-store" });
        if (!response.ok) throw new Error("Learner session unavailable");
        const data = await response.json() as { learner?: { name?: unknown } | null };
        if (!active) return;
        setLearner(typeof data.learner?.name === "string" ? { name: data.learner.name } : null);
      } catch {
        if (active) setLearner(null);
      }
    };

    void loadLearner();
    window.addEventListener("mcqpath:learner-session-change", loadLearner);
    return () => {
      active = false;
      window.removeEventListener("mcqpath:learner-session-change", loadLearner);
    };
  }, []);

  return (
    <Link
      className={`header-account-link${learner ? " is-signed-in" : ""}`}
      href="/account"
      aria-label={learner ? `My account: ${learner.name}` : "Log in to your account"}
      title={learner ? `Account for ${learner.name}` : "Log in"}
    >
      <UserRound size={16} aria-hidden="true" />
      <span>{learner?.name ?? "Log in"}</span>
    </Link>
  );
}
