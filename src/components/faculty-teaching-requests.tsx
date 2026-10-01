import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, Clock3, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { mapAssignmentRpcError } from "@/lib/academic-delivery/teaching-assignments-v2";
import {
  facultyWorkflow,
  requestStatusLabel,
  type FacultyRequest,
} from "@/lib/instructors/faculty-workflow";
import {
  filterFacultyRequests,
  requestDirection,
  type RequestDirection,
  type RequestStatusFilter,
} from "@/lib/instructors/faculty-request-display";

const PAGE_SIZE = 6;
const statusNames = {
  all: "كل الطلبات",
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
  cancelled: "ملغى",
};
const statusClasses = {
  pending:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  approved:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  rejected:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "border-border bg-muted text-muted-foreground",
};
const actionNames = { approved: "اعتماد التكليف", rejected: "رفض الطلب", cancelled: "إلغاء الطلب" };
type Decision = keyof typeof actionNames;

function Status({ status }: { status: FacultyRequest["status"] }) {
  const Icon = status === "pending" ? Clock3 : status === "approved" ? Check : X;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses[status]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {statusNames[status]}
    </span>
  );
}

function requestDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "تاريخ غير متاح"
    : new Intl.DateTimeFormat("ar-SA", {
        calendar: "gregory",
        numberingSystem: "latn",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Riyadh",
      }).format(date);
}

export function FacultyTeachingRequests({ collegeId }: { collegeId: string }) {
  // A college change starts a new view and cannot retain another college's open request.
  return <RequestsPanel key={collegeId} collegeId={collegeId} />;
}

function RequestsPanel({ collegeId }: { collegeId: string }) {
  const panelId = useId();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<RequestStatusFilter>("all");
  const [direction, setDirection] = useState<RequestDirection>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["faculty-teaching-requests", collegeId],
    queryFn: async () => {
      const { data, error } = await facultyWorkflow.rpc("list_faculty_teaching_requests", {
        p_college_id: collegeId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = list.data ?? [];
  const selected = rows.find((r) => r.id === selectedId);
  const canAct = (r: FacultyRequest, choice: Decision) =>
    r.status === "pending" && (choice === "cancelled" ? r.can_cancel : r.can_decide);
  const closeDetails = () => {
    setSelectedId(null);
    setAction(null);
    setNote("");
    setSaveError(null);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !action || !canAct(selected, action))
        throw new Error("لم يعد القرار متاحًا لهذا الطلب؛ حدّث القائمة.");
      const { error } = await facultyWorkflow.rpc("decide_faculty_teaching_request", {
        p_request_id: selected.id,
        p_decision: action,
        p_note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ قرار التكليف");
      closeDetails();
      void qc.invalidateQueries();
    },
    onError: (error: Error) => {
      const message = mapAssignmentRpcError(error.message).message;
      setSaveError(message);
      toast.error(message);
    },
  });
  const filtered = filterFacultyRequests(rows, { collegeId, status, direction, search });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pending = rows.filter((r) => r.status === "pending").length;
  const resetFilters = () => {
    setStatus("all");
    setDirection("all");
    setSearch("");
    setPage(1);
  };

  return (
    <section
      className="my-4 overflow-hidden rounded-xl border bg-card shadow-sm"
      dir="rtl"
      aria-label="طلبات التكليف بين الكليات"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-secondary p-2 text-primary">
            <ArrowLeftRight className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-bold">طلبات التكليف بين الكليات</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {list.isLoading
                ? "جارٍ تحميل الطلبات…"
                : list.error
                  ? "تعذر تحديث الطلبات"
                  : pending
                    ? `${pending} طلب بانتظار الاعتماد`
                    : rows.length
                      ? "لا توجد طلبات معلّقة"
                      : "لا توجد طلبات تكليف لهذه الكلية"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "طي الطلبات" : "عرض الطلبات"}
          {expanded ? (
            <ChevronUp className="ms-2 h-4 w-4" />
          ) : (
            <ChevronDown className="ms-2 h-4 w-4" />
          )}
        </Button>
      </div>
      {!list.isLoading && !list.error && rows.length > 0 && (
        <div
          className="flex flex-wrap gap-2 px-4 pb-4"
          role="group"
          aria-label="تصفية الطلبات حسب الحالة"
        >
          {(Object.keys(statusNames) as RequestStatusFilter[]).map((value) => {
            const count =
              value === "all" ? rows.length : rows.filter((r) => r.status === value).length;
            return (
              <button
                type="button"
                key={value}
                aria-pressed={expanded && status === value}
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                  setExpanded(true);
                }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${expanded && status === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
              >
                {statusNames[value]}
                <span className="font-bold tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}
      {list.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-t bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>تعذر تحميل الطلبات. حاول مرة أخرى.</span>
          <Button
            size="sm"
            variant="outline"
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
          >
            إعادة المحاولة
          </Button>
        </div>
      )}
      {expanded && (
        <div id={panelId} className="border-t">
          <div className="space-y-3 bg-muted/30 p-4">
            <p className="text-xs leading-5 text-muted-foreground">
              يُحتسب التكليف في النصاب بعد اعتماد الكلية الأصلية. اعتماد الطلب لا يغيّر مواعيد
              الجداول.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <Search
                  className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  className="h-10 w-full rounded-md border bg-background pe-3 ps-9 text-sm"
                  aria-label="بحث في طلبات التكليف"
                  placeholder="ابحث باسم المحاضر أو الكلية أو المجموعة…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm sm:w-64"
                aria-label="اتجاه طلب التكليف"
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value as RequestDirection);
                  setPage(1);
                }}
              >
                <option value="all">كل الاتجاهات</option>
                <option value="incoming">واردة لاعتماد محاضري الكلية</option>
                <option value="outgoing">صادرة للاستعانة بمحاضرين</option>
              </select>
              {(search || status !== "all" || direction !== "all") && (
                <Button variant="ghost" onClick={resetFilters}>
                  مسح التصفية
                </Button>
              )}
            </div>
          </div>
          {list.isLoading ? (
            <p role="status" className="p-6 text-center text-sm text-muted-foreground">
              جارٍ تحميل الطلبات…
            </p>
          ) : !list.error && filtered.length === 0 ? (
            <p role="status" className="p-8 text-center text-sm text-muted-foreground">
              {rows.length
                ? "لا توجد طلبات مطابقة للتصفية الحالية."
                : "ستظهر هنا طلبات التكليف بين الكليات عند إنشائها."}
            </p>
          ) : (
            !list.error && (
              <>
                <div
                  className="hidden grid-cols-[1.5fr_1.8fr_1.1fr_1fr_auto] gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground lg:grid"
                  aria-hidden="true"
                >
                  <span>المحاضر والطلب</span>
                  <span>الكليات</span>
                  <span>التكليف</span>
                  <span>الحالة</span>
                  <span className="w-20">التفاصيل</span>
                </div>
                <ul className="divide-y">
                  {visible.map((r) => (
                    <li
                      key={r.id}
                      className="grid gap-3 p-4 transition-colors hover:bg-muted/20 lg:grid-cols-[1.5fr_1.8fr_1.1fr_1fr_auto] lg:items-center lg:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{r.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.is_update ? "تعديل ساعات تكليف" : "تكليف جديد"} ·{" "}
                          <time dateTime={r.created_at}>{requestDate(r.created_at)}</time>
                        </p>
                      </div>
                      <div className="space-y-1 text-xs leading-5">
                        <p>
                          <span className="text-muted-foreground">الأصلية: </span>
                          {r.home_college}
                        </p>
                        <p>
                          <span className="text-muted-foreground">المستفيدة: </span>
                          {r.college}
                        </p>
                      </div>
                      <div className="text-xs leading-5">
                        <p className="font-semibold">
                          {r.hours} ساعة · {r.group || "مجموعة غير محددة"}
                        </p>
                        <p className="text-muted-foreground">{r.term}</p>
                      </div>
                      <Status status={r.status} />
                      <Button
                        className="w-fit lg:w-20"
                        variant={
                          r.status === "pending" && (r.can_decide || r.can_cancel)
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        aria-label={`تفاصيل طلب ${r.name}، ${r.group}، ${r.hours} ساعة`}
                        onClick={() => {
                          setSelectedId(r.id);
                          setAction(null);
                          setNote("");
                          setSaveError(null);
                        }}
                      >
                        {r.status === "pending" && r.can_decide ? "مراجعة" : "التفاصيل"}
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground" role="status">
                    عرض {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, filtered.length)} من {filtered.length} طلب
                  </p>
                  {pageCount > 1 && (
                    <nav className="flex items-center gap-2" aria-label="صفحات طلبات التكليف">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={currentPage === 1}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        السابق
                      </Button>
                      <span className="text-xs tabular-nums">
                        {currentPage} / {pageCount}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={currentPage === pageCount}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        التالي
                      </Button>
                    </nav>
                  )}
                </div>
              </>
            )
          )}
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !save.isPending) closeDetails();
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>تفاصيل طلب التكليف</DialogTitle>
          <DialogDescription>
            راجع المحاضر والكلية المستفيدة والساعات قبل اتخاذ القرار.
          </DialogDescription>
          {selected && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
                <div>
                  <p className="font-semibold">{selected.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    الرقم الجامعي: <bdi>{selected.university_number}</bdi>
                  </p>
                </div>
                <Status status={selected.status} />
              </div>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                {[
                  ["الكلية الأصلية", selected.home_college],
                  ["الكلية المستفيدة", selected.college],
                  ["الفصل الدراسي", selected.term],
                  ["المجموعة", selected.group],
                  ["الساعات المطلوبة", `${selected.hours} ساعة`],
                  ["نوع الطلب", selected.is_update ? "تعديل ساعات تكليف" : "تكليف جديد"],
                  ["تاريخ الطلب", requestDate(selected.created_at)],
                  [
                    "اتجاه الطلب",
                    requestDirection(selected, collegeId) === "incoming"
                      ? "وارد لاعتماد محاضر من الكلية"
                      : "صادر للاستعانة بمحاضر",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="mb-1 text-xs text-muted-foreground">{label}</dt>
                    <dd className="leading-6">{value || "غير محدد"}</dd>
                  </div>
                ))}
              </dl>
              {selected.notes && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="mb-1 font-medium">ملاحظات الطلب</p>
                  <p className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">
                    {selected.notes}
                  </p>
                </div>
              )}
              {selected.decision_note && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="mb-1 font-medium">مرجع القرار</p>
                  <p className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">
                    {selected.decision_note}
                  </p>
                </div>
              )}
              {selected.status === "pending" && !selected.can_decide && (
                <p className="text-xs leading-5 text-muted-foreground">
                  {requestStatusLabel.pending}.
                </p>
              )}
              {selected.status === "pending" && !action && (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {(Object.keys(actionNames) as Decision[])
                    .filter((value) => canAct(selected, value))
                    .map((value) => (
                      <Button
                        key={value}
                        variant={value === "approved" ? "default" : "outline"}
                        onClick={() => {
                          setAction(value);
                          setNote("");
                          setSaveError(null);
                        }}
                      >
                        {actionNames[value]}
                      </Button>
                    ))}
                </div>
              )}
              {action && canAct(selected, action) && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm font-semibold">{actionNames[action]}</p>
                  <label className="block text-sm">
                    مرجع القرار
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-md border bg-background p-3"
                      value={note}
                      disabled={save.isPending}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="أدخل مرجع القرار أو سببه (3 أحرف على الأقل)"
                    />
                  </label>
                  {action === "approved" && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      يعيد النظام فحص المجموعة والتبعية والساعات عند الاعتماد. لا تتغير مواعيد
                      الجدول.
                    </p>
                  )}
                  {saveError && (
                    <p role="alert" className="text-sm text-destructive">
                      {saveError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={action === "approved" ? "default" : "destructive"}
                      disabled={save.isPending || note.trim().length < 3}
                      onClick={() => save.mutate()}
                    >
                      {save.isPending ? "جارٍ الحفظ…" : `تأكيد ${actionNames[action]}`}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={save.isPending}
                      onClick={() => {
                        setAction(null);
                        setSaveError(null);
                      }}
                    >
                      رجوع
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                رقم الطلب: <bdi className="break-all font-mono">{selected.id}</bdi>
              </p>
              <Button variant="outline" disabled={save.isPending} onClick={closeDetails}>
                إغلاق
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
