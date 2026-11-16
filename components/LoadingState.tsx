type LoadingSpinnerProps = {
  label?: string;
  size?: "small" | "medium" | "large";
  className?: string;
};

export function LoadingSpinner({ label = "Loading", size = "medium", className = "" }: LoadingSpinnerProps) {
  return <span className={`loading-spinner loading-spinner-${size} ${className}`.trim()} role="status" aria-label={label} />;
}

export function LoadingState({ label, variant = "section", className = "" }: {
  label: string;
  variant?: "section" | "inline";
  className?: string;
}) {
  return (
    <div className={`loading-panel loading-state loading-state-${variant} ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
      <LoadingSpinner label={label} size={variant === "section" ? "large" : "medium"} />
      <span>{label}</span>
    </div>
  );
}
