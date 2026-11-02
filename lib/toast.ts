import { toast } from "react-hot-toast";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { createElement } from "react";

const base = { duration: 4500, position: "top-right" as const };

export const notify = {
  success(message: string) {
    if (message.trim()) toast.success(message, { ...base, icon: createElement(CircleCheck, { size: 18, "aria-hidden": true }), style: { background: "#edf8f1", color: "#185b3d", border: "1px solid #add8bc" } });
  },
  error(message: string) {
    if (message.trim()) toast.error(message, { ...base, duration: 6000, icon: createElement(CircleX, { size: 18, "aria-hidden": true }), style: { background: "#fff0ef", color: "#8f2522", border: "1px solid #edb7b3" } });
  },
  warning(message: string) {
    if (message.trim()) toast(message, { ...base, icon: createElement(TriangleAlert, { size: 18, "aria-hidden": true }), style: { background: "#fff7d6", color: "#704f00", border: "1px solid #f0d36a" } });
  },
  info(message: string) {
    if (message.trim()) toast(message, { ...base, icon: createElement(Info, { size: 18, "aria-hidden": true }), style: { background: "#eaf4ff", color: "#174c7d", border: "1px solid #a9cfee" } });
  },
};
