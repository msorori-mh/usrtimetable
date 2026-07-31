import { Badge } from "@/components/ui/badge";
import {
  CLASSIFICATION_LABEL_AR,
  CLASSIFICATION_LABEL_EN,
  resolveDataClassification,
  type ClassificationSource,
  type DataClassification,
} from "@/lib/schedule-versions/data-classification";
import { cn } from "@/lib/utils";

const VARIANT: Record<
  DataClassification,
  "secondary" | "default" | "outline" | "destructive"
> = {
  test: "secondary",
  demo: "outline",
  operational: "default",
  archived: "destructive",
};

const TONE: Record<DataClassification, string> = {
  test: "border-slate-400 text-slate-800 dark:text-slate-100",
  demo: "border-amber-500 text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40",
  operational:
    "border-emerald-600 text-emerald-900 dark:text-emerald-100 bg-emerald-50 dark:bg-emerald-950/30",
  archived: "",
};

export function DataClassificationBadge(
  props: ClassificationSource & { className?: string; showWhenNull?: boolean },
) {
  const cls = resolveDataClassification(props);
  if (!cls) {
    if (!props.showWhenNull) return null;
    return (
      <Badge
        variant="secondary"
        data-testid="data-classification-badge"
        data-classification="unclassified"
        className={cn(props.className)}
      >
        غير مصنّف
      </Badge>
    );
  }
  return (
    <Badge
      variant={VARIANT[cls]}
      data-testid="data-classification-badge"
      data-classification={cls}
      className={cn(TONE[cls], props.className)}
      title={CLASSIFICATION_LABEL_AR[cls]}
    >
      {CLASSIFICATION_LABEL_EN[cls]}
    </Badge>
  );
}
