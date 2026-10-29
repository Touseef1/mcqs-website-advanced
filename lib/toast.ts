import { toast } from "react-hot-toast";

const base = { duration: 4500, position: "top-right" as const };

export const notify = {
  success(message: string) {
    if (message.trim()) toast.success(message, base);
  },
  error(message: string) {
    if (message.trim()) toast.error(message, { ...base, duration: 6000 });
  },
  warning(message: string) {
    if (message.trim()) toast(message, { ...base, icon: "⚠", style: { background: "#fff7d6", color: "#704f00", border: "1px solid #f0d36a" } });
  },
  info(message: string) {
    if (message.trim()) toast(message, { ...base, icon: "ℹ", style: { background: "#eaf4ff", color: "#174c7d", border: "1px solid #a9cfee" } });
  },
};
