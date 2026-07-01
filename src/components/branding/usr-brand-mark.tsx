import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  size?: "sm" | "md" | "lg" | "xl" | "hero";
  variant?: "default" | "onPrimary";
  className?: string;
}

const sizeMap = {
  sm: { box: "h-8 w-8", icon: "h-4 w-4" },
  md: { box: "h-10 w-10", icon: "h-5 w-5" },
  lg: { box: "h-12 w-12", icon: "h-6 w-6" },
  xl: { box: "h-16 w-16", icon: "h-8 w-8" },
  hero: { box: "h-24 w-24 md:h-28 md:w-28", icon: "h-11 w-11 md:h-14 md:w-14" },
};

/** رمز مؤقت رسمي — بدون شعار خارجي. */
export function UsrBrandMark({ size = "md", variant = "default", className }: Props) {
  const s = sizeMap[size];
  return (
    <div
      className={cn(
        "grid place-items-center rounded-lg shadow-sm",
        variant === "default"
          ? "bg-[image:var(--gradient-hero)] text-primary-foreground ring-2 ring-[var(--usr-gold)]/40 shadow-[var(--shadow-card)]"
          : "bg-white/15 text-primary-foreground ring-2 ring-white/30 backdrop-blur",
        s.box,
        className,
      )}
      aria-hidden
    >
      <GraduationCap className={s.icon} />
    </div>
  );
}
