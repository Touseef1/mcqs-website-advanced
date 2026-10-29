"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type ConfirmModalOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "warning" | "danger";
};

type PendingConfirm = {
  options: ConfirmModalOptions;
  run: () => Promise<unknown>;
  resolve: (value: boolean) => void;
  reject: (reason: unknown) => void;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmModalOptions, run: () => Promise<unknown>) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirmModal() {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error("useConfirmModal must be used inside ConfirmModalProvider.");
  return value.confirm;
}

export function ConfirmModalProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback<ConfirmContextValue["confirm"]>((options, run) => new Promise((resolve, reject) => {
    setPending({ options, run, resolve, reject });
  }), []);

  async function accept() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await pending.run();
      pending.resolve(true);
      setPending(null);
    } catch (error) {
      pending.reject(error);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (!pending || busy) return;
    pending.resolve(false);
    setPending(null);
  }

  return <ConfirmContext.Provider value={{ confirm }}>
    {children}
    {pending && <ConfirmModal options={pending.options} busy={busy} onConfirm={() => { void accept(); }} onCancel={cancel} />}
  </ConfirmContext.Provider>;
}

function ConfirmModal({ options, busy, onConfirm, onCancel }: { options: ConfirmModalOptions; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <div className="confirm-modal-backdrop" role="presentation">
    <section className={`confirm-modal confirm-modal-${options.variant ?? "default"}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-message">
      <span className="confirm-modal-icon" aria-hidden="true">{options.variant === "danger" ? "!" : options.variant === "warning" ? "⚠" : "?"}</span>
      <h2 id="confirm-modal-title">{options.title}</h2>
      <p id="confirm-modal-message">{options.message}</p>
      <div className="confirm-modal-actions">
        <button className="button button-light" type="button" onClick={onCancel} disabled={busy}>{options.cancelLabel ?? "Cancel"}</button>
        <button className={`button ${options.variant === "danger" ? "button-danger" : "button-primary"}`} type="button" onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : options.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </section>
  </div>;
}
