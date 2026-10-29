"use client";

import type { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { ConfirmModalProvider } from "@/components/ConfirmModal";
import { ImageLightboxProvider } from "@/components/ImageLightbox";

export function AppFeedback({ children }: { children: ReactNode }) {
  return <ConfirmModalProvider><ImageLightboxProvider>
    {children}
    <Toaster position="top-right" toastOptions={{ duration: 4500, style: { maxWidth: "min(460px, calc(100vw - 32px))", borderRadius: "12px", boxShadow: "0 12px 36px rgba(16, 45, 35, .18)", fontSize: "14px", lineHeight: 1.45, whiteSpace: "pre-line" } }} />
  </ImageLightboxProvider></ConfirmModalProvider>;
}
