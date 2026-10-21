"use client";

import { useRouter } from "next/navigation";

export function AdminSignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  }
  return <button className="button button-secondary" onClick={() => void signOut()}>Sign out</button>;
}
