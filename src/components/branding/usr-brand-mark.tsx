import { cn } from "@/lib/utils";
import { USR_UNIVERSITY_LOGO_SRC, USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";

interface Props {
  size?: "sm" | "md" | "lg" | "xl" | "hero";
  variant?: "default" | "onPrimary";
  className?: string;
}

const sizeMap = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
  hero: "h-28 w-28 md:h-32 md:w-32",
};

/** شعار جامعة إقليم سبأ الرسمي */
export function UsrBrandMark({ size = "md", variant = "default", className }: Props) {
  return (
    <img
      src={USR_UNIVERSITY_LOGO_SRC}
      alt={`شعار ${USR_UNIVERSITY_NAME_AR}`}
      width={128}
      height={128}
      className={cn(
        "object-contain shrink-0",
        sizeMap[size],
        variant === "onPrimary"
          ? "drop-shadow-[0_4px_12px_rgb(0_0_0_/_0.35)]"
          : "drop-shadow-sm",
        className,
      )}
    />
  );
}
