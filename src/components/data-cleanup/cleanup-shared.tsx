import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  type BulkItem,
  runBulkConfirm,
  selectAll,
  selectedIds,
  shortRef,
} from "@/lib/data-cleanup-bulk";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { userErrorMessage } from "@/lib/user-error";
import { formatNumber } from "@/lib/format";
import { CourseRow, fetchAll } from "@/components/data-cleanup/cleanup-data";
import { Issue, Diagnostics, pct } from "@/components/data-cleanup/cleanup-diagnostics";

/** Shared data-cleanup UI: dashboard cards, issue row, bulk item builders and bulk dialog. */
// ---------- dashboard ----------
export function DashboardCards({ diag, loading }: { diag: Diagnostics | null; loading: boolean }) {
  if (loading || !diag) {
    return <Card className="p-6 text-muted-foreground">جارٍ التحميل...</Card>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">الجاهزية الحالية</div>
        <div className="mt-1 text-3xl font-bold">{formatNumber(diag.readiness)}%</div>
        <Progress value={diag.readiness} className="mt-2 h-2" />
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">الجاهزية المتوقّعة بعد الإصلاح</div>
        <div className="mt-1 text-3xl font-bold text-emerald-600">
          {formatNumber(diag.estimatedAfter)}%
        </div>
        <Progress value={diag.estimatedAfter} className="mt-2 h-2" />
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4" /> مشاكل حرجة
        </div>
        <div className="mt-1 text-3xl font-bold text-red-600">{diag.critical}</div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4" /> مشاكل متوسطة
        </div>
        <div className="mt-1 text-3xl font-bold text-amber-600">{diag.medium}</div>
      </Card>
    </div>
  );
}

// ---------- shared issue row ----------
export function IssueRow({
  issue,
  actions,
}: {
  issue: Issue | undefined;
  actions?: React.ReactNode;
}) {
  if (!issue) return null;
  const p = pct(issue.count, issue.total);
  const okay = issue.count === 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {okay ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : issue.severity === "critical" ? (
            <ShieldAlert className="h-4 w-4 text-red-600" />
          ) : issue.severity === "medium" ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{issue.label}</span>
          <Badge variant="outline" className="text-[10px]">
            {formatNumber(issue.count)}/{formatNumber(issue.total)}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {formatNumber(p)}%
          </Badge>
          {!okay && issue.impactPct > 0 && (
            <Badge className="bg-rose-100 text-[10px] text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
              يقلل الجاهزية ~{formatNumber(issue.impactPct)}%
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {okay
            ? "لا توجد مشاكل في هذا البند."
            : `${formatNumber(issue.count)} عنصر يحتاج المراجعة، ما يمثّل ${formatNumber(p)}% من الإجمالي.`}
        </div>
      </div>
      {!okay && actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- bulk item builders ----------
export type CleanupData = Awaited<ReturnType<typeof fetchAll>>;
export const joinDetails = (parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(" · ");
export const NATURE_AR: Record<string, string> = {
  department: "قسم",
  college: "كلية",
  university: "جامعة",
};
export const SYSTEM_AR: Record<string, string> = {
  regular: "انتظام",
  parallel: "موازي",
  both: "كلاهما",
};

export function lookups(d: CleanupData | undefined) {
  return {
    course: new Map((d?.courses ?? []).map((c) => [c.id, c])),
    dept: new Map((d?.departments ?? []).map((x) => [x.id, x.name])),
    insType: new Map((d?.instructorTypes ?? []).map((x) => [x.id, x.name_ar])),
    roomType: new Map((d?.roomTypes ?? []).map((x) => [x.id, x.name_ar])),
  };
}
export const courseTitle = (c: CourseRow | undefined, id: string) =>
  c ? joinDetails([c.code, c.name]) || shortRef(id) : shortRef(id);

export function courseItems(
  d: CleanupData | undefined,
  ids: string[] | undefined,
  reason: string,
): BulkItem[] {
  const L = lookups(d);
  return (ids ?? []).map((id) => {
    const c = L.course.get(id);
    return {
      id,
      title: courseTitle(c, id),
      details: joinDetails([
        `الطبيعة: ${c?.course_nature ? (NATURE_AR[c.course_nature] ?? c.course_nature) : "غير محددة"}`,
        `القسم: ${(c?.department_id && L.dept.get(c.department_id)) || "غير محدد"}`,
        `السبب: ${reason}`,
      ]),
    };
  });
}

export function planCourseItems(d: CleanupData | undefined, ids: string[] | undefined): BulkItem[] {
  const L = lookups(d);
  const pcs = new Map((d?.planCourses ?? []).map((p) => [p.id, p]));
  return (ids ?? []).map((id) => {
    const p = pcs.get(id);
    return {
      id,
      title: p ? courseTitle(L.course.get(p.course_id), id) : shortRef(id),
      details: joinDetails([
        `محاضرات/أسبوع: ${p?.lectures_per_week ?? 0}، معامل/أسبوع: ${p?.labs_per_week ?? 0}`,
        `قاعة المحاضرة: ${p?.required_room_type_for_lecture || "غير محددة"}`,
        `قاعة المعمل: ${p?.required_room_type_for_lab || "غير محددة"}`,
        "السبب: متطلبات القاعة ناقصة",
      ]),
    };
  });
}

export function instructorItems(
  d: CleanupData | undefined,
  ids: string[] | undefined,
  reason: string,
): BulkItem[] {
  const L = lookups(d);
  const ins = new Map((d?.instructors ?? []).map((i) => [i.id, i]));
  return (ids ?? []).map((id) => {
    const i = ins.get(id);
    return {
      id,
      title: i?.full_name?.trim() || shortRef(id),
      details: joinDetails([
        `القسم: ${(i?.department_id && L.dept.get(i.department_id)) || "غير محدد"}`,
        `التخصص: ${i?.specialization?.trim() || "غير محدد"}`,
        `النوع: ${(i?.instructor_type_id && L.insType.get(i.instructor_type_id)) || "غير محدد"}`,
        `السبب: ${reason}`,
      ]),
    };
  });
}

export function roomBulkItems(
  d: CleanupData | undefined,
  ids: string[] | undefined,
  reason: string,
): BulkItem[] {
  const L = lookups(d);
  const rooms = new Map((d?.rooms ?? []).map((r) => [r.id, r]));
  return (ids ?? []).map((id) => {
    const r = rooms.get(id);
    return {
      id,
      title: r ? joinDetails([r.code, r.name]) || shortRef(id) : shortRef(id),
      details: joinDetails([
        `السعة: ${r?.capacity ?? "—"}`,
        `النوع: ${(r?.room_type_id && L.roomType.get(r.room_type_id)) || "غير محدد"}`,
        r ? (r.is_active ? "نشطة" : "غير نشطة") : null,
        `السبب: ${reason}`,
      ]),
    };
  });
}

export function offeringItems(
  d: CleanupData | undefined,
  ids: string[] | undefined,
  reason: string,
): BulkItem[] {
  const L = lookups(d);
  const offs = new Map((d?.offerings ?? []).map((o) => [o.id, o]));
  return (ids ?? []).map((id) => {
    const o = offs.get(id);
    return {
      id,
      title: o ? courseTitle(L.course.get(o.course_id), id) : shortRef(id),
      details: joinDetails([
        `الطلاب المتوقعون: ${o?.expected_students ?? "—"}`,
        `النظام: ${o?.study_system ? (SYSTEM_AR[o.study_system] ?? o.study_system) : "غير محدد"}`,
        o?.plan_course_id ? "مرتبط بمقرر خطة" : "غير مرتبط بمقرر خطة",
        `السبب: ${reason}`,
      ]),
    };
  });
}

// ---------- bulk dialog (generic) ----------
export function BulkDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  children,
  onConfirm,
  confirmLabel = "تنفيذ",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  items: BulkItem[];
  children?: React.ReactNode;
  /** Return true only on full success; anything else keeps the dialog open. */
  onConfirm: (selected: string[]) => Promise<boolean> | boolean;
  confirmLabel?: string;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const itemsKey = items.map((i) => i.id).join(",");

  // Controlled open: initialise on prop change, not via onOpenChange.
  useEffect(() => {
    if (open) setSelected(selectAll(items));
    else setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemsKey]);

  const chosen = selectedIds(items, selected);
  const allSelected = items.length > 0 && chosen.length === items.length;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent dir="rtl" className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            سيتم تطبيق العملية على <strong>{formatNumber(chosen.length)}</strong> من أصل{" "}
            <strong>{formatNumber(items.length)}</strong> عنصر.
            {items.length > 0 && (
              <button
                type="button"
                className="ms-2 text-primary underline-offset-2 hover:underline"
                onClick={() => setSelected(allSelected ? {} : selectAll(items))}
              >
                {allSelected ? "إلغاء التحديد" : "تحديد الكل"}
              </button>
            )}
          </div>
          <ul
            className="max-h-60 min-h-0 overflow-y-auto rounded-md border divide-y"
            aria-label="العناصر المحددة للإصلاح"
          >
            {items.map((it) => (
              <li key={it.id}>
                <label className="flex cursor-pointer items-start gap-2 p-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={!!selected[it.id]}
                    onCheckedChange={(v) => setSelected((s) => ({ ...s, [it.id]: v === true }))}
                    aria-label={it.title}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{it.title}</span>
                    {it.details && (
                      <span className="block break-words text-[11px] text-muted-foreground">
                        {it.details}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {children}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            إلغاء
          </Button>
          <Button
            disabled={busy || chosen.length === 0}
            onClick={async () => {
              setBusy(true);
              // L-5: map raw database errors before runBulkConfirm formats them.
              const safeConfirm = async (ids: string[]) => {
                try {
                  return await onConfirm(ids);
                } catch (e) {
                  throw new Error(userErrorMessage(e));
                }
              };
              const ok = await runBulkConfirm(safeConfirm, chosen, (m) => toast.error(m));
              setBusy(false);
              if (ok) onOpenChange(false);
            }}
          >
            {busy ? "جارٍ التنفيذ..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
