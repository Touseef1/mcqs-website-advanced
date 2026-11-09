import type { LucideIcon } from "lucide-react";

export function AdminFormCardHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <header className="admin-form-card-header">
    <span className="admin-form-card-icon"><Icon size={18} strokeWidth={1.9} aria-hidden="true" /></span>
    <div><h3>{title}</h3><p>{description}</p></div>
  </header>;
}
