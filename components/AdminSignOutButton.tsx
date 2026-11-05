"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";

export function AdminSignOutButton() {
  const router = useRouter();
  async function signOut() {
    try {
      const response = await fetch("/api/admin/logout", { method: "POST" });
      await parseApiResponse(response, "Could not sign out.");
      router.refresh();
    } catch (cause) { notify.error(getErrorMessage(cause, "Could not sign out.")); }
  }
  return <button className="button button-secondary" onClick={() => void signOut()}><LogOut size={15} aria-hidden="true" /><span>Sign out</span></button>;
}
