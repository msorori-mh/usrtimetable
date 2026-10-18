import { canManageTeachingPay } from "@/lib/viewer-roles";
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ACADEMIC_RANKS } from "@/lib/instructor-metadata";
import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
import { ReportOfficialHeader } from "@/components/reports/report-official-header";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PAY_KINDS,
  PAY_SYSTEMS,
  PAY_HEADERS,
  applicableRate,
  filterPayEntries,
  parsePayData,
  payReportRows,
  payTotals,
  type PayFilter,
  type PayData,
} from "@/lib/reports/teaching-pay";
import { formatNumber } from "@/lib/format";
import { userErrorMessage } from "@/lib/user-error";
import { confirmAction } from "@/components/confirm-dialog";

type Api = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Functions: {
      save_teaching_pay_rates: {
        Args: { p_college_id: string; p_payload: Record<string, unknown> };
        Returns: { ok: boolean; ids: string[]; count: number };
      };
      teaching_payroll: {
        Args: {
          p_college_id: string;
          p_action: string;
          p_payload: Record<string, unknown>;
        };
        Returns: unknown;
      };
    };
  };
};
const client = supabase as unknown as SupabaseClient<Api>;
const blankFilter: PayFilter = {
  department: "",
  program: "",
  instructor: "",
  system: "",
  kind: "",
  from: "",
  to: "",
};
const controlClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
function Options({ values }: { values: Record<string, string> }) {
  return Object.entries(values).map(([id, label]) => (
    <option key={id} value={id}>
      {label}
    </option>
  ));
}

export function TeachingPayReport(props: {
  collegeId: string;
  collegeName: string;
  initialTermId?: string;
}) {
  const me = useCurrentUser();
  if (me.isLoading) return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (me.error)
    return (
      <Card className="p-6">
        تعذر التحقق من الصلاحيات. <Button onClick={() => void me.refetch()}>إعادة المحاولة</Button>
      </Card>
    );
  if (!canManageTeachingPay(me.data))
    return (
      <Card className="p-6">
        إدارة أجور التدريس وكشوفها متاحة للشؤون الأكاديمية والأدمن العام فقط.
      </Card>
    );
  return <PayWorkspace {...props} />;
}

function PayWorkspace({
  collegeId,
  collegeName,
  initialTermId,
}: {
  collegeId: string;
  collegeName: string;
  initialTermId?: string;
}) {
  const [term, setTerm] = useState(initialTermId ?? "");
  const [filter, setFilter] = useState<PayFilter>(blankFilter);
  const [mode, setMode] = useState<"report" | "entries" | "rates">("report");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [review, setReview] = useState<{
    id: string;
    rateId: string;
    amount: number;
    currency: string;
  } | null>(null);
  const call = async (action: string, payload: Record<string, unknown>) => {
    const { data, error } =
      action === "save_rates"
        ? await client.rpc("save_teaching_pay_rates", {
            p_college_id: collegeId,
            p_payload: payload,
          })
        : await client.rpc("teaching_payroll", {
            p_college_id: collegeId,
            p_action: action,
            p_payload: payload,
          });
    if (error) throw new Error(error.message);
    return data;
  };
  const query = useQuery({
    queryKey: ["teaching-pay", collegeId, term],
    queryFn: async () => parsePayData(await call("read", { term_id: term })),
  });
  const data = query.data;
  const invalidDates = !!filter.from && !!filter.to && filter.from > filter.to;
  const safe = !query.isFetching && !query.error && !invalidDates;
  const entries = safe ? filterPayEntries(data?.entries ?? [], filter) : [];
  const rows = payReportRows(entries);
  const totals = payTotals(entries);
  const totalLabel =
    Object.entries(totals)
      .map(([currency, n]) => `${formatNumber(n)} ${currency}`)
      .join(" · ") || "لا توجد مستحقات معتمدة";
  const termName = data?.terms.find((t) => t.id === term)?.name ?? "لم يحدد الفصل";
  const programs = [
    ...new Map(
      [
        ...(data?.programs ?? []),
        ...(data?.entries ?? []).map((e) => ({
          id: e.program_id,
          name: e.program_name,
          department_id: e.department_id,
          department_name: e.department_name,
        })),
      ].map((p) => [p.id, p]),
    ).values(),
  ];
  const departments = Object.fromEntries(programs.map((p) => [p.department_id, p.department_name]));
  const instructors = Object.fromEntries([
    ...(data?.instructors ?? []).map((i) => [i.id, i.name]),
    ...(data?.entries ?? []).map((e) => [e.identity_id, e.instructor_name]),
  ]);
  const summary = [
    collegeName,
    termName,
    filter.from ? `من ${filter.from}` : "بداية الفصل",
    filter.to ? `إلى ${filter.to}` : "نهاية الفصل",
    departments[filter.department],
    programs.find((p) => p.id === filter.program)?.name,
    instructors[filter.instructor],
    PAY_KINDS[filter.kind as keyof typeof PAY_KINDS],
    PAY_SYSTEMS[filter.system as keyof typeof PAY_SYSTEMS],
  ]
    .filter(Boolean)
    .join(" · ");
  const filename = `كشف مستحقات التدريس الفعلي — ${summary}`;
  const set = (key: keyof PayFilter, value: string) => {
    setFilter((f) => ({
      ...f,
      [key]: value,
      ...(key === "department" ? { program: "" } : {}),
    }));
    setReview(null);
  };
  const mutate = async (action: string, payload: Record<string, unknown>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    setMutationError("");
    try {
      await call(action, payload);
      setMessage(
        action === "approve"
          ? "تم الاعتماد المالي وتثبيت السعر والمبلغ."
          : action === "save_rates"
            ? "تم حفظ جميع إصدارات الأسعار المختارة."
            : action === "void"
              ? "تم إلغاء المسودة مع حفظ أثرها."
              : "تم حفظ التنفيذ للمراجعة المالية.",
      );
      setReview(null);
      await query.refetch();
      return true;
    } catch (error) {
      setMutationError(userErrorMessage(error, "تعذر الحفظ"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>, action: string) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (
      await mutate(action, {
        ...payload,
        term_id: term,
        certified: payload.certified === "on",
      })
    )
      form.reset();
  };
  return (
    <ReportShell
      title="أجور التدريس الفعلي"
      description="إعداد الأسعار، تسجيل الساعات المنفذة المعتمدة، وتجهيز كشوف المستحقات للأمين العام."
      printContent={
        <>
          <style>{`@page { size: A4 landscape; margin: 10mm; } .teaching-pay-print { font-size: 9pt; }`}</style>
          <RepeatingPrintHeader
            header={
              <ReportOfficialHeader
                reportTitle="كشف مستحقات التدريس الفعلي"
                collegeName={collegeName}
                termName={termName}
                note={`إلى الأخ الأمين العام — ${summary}`}
              />
            }
          >
            <div className="teaching-pay-print">
              <p className="my-3">
                إجمالي المستحقات: {totalLabel} · سجلات التنفيذ المعتمدة: {rows.length}
              </p>
              <ReportDataTable
                columns={PAY_HEADERS.filter(
                  (h) =>
                    !["id", "university_number", "department", "time", "approved_at"].includes(
                      h.key,
                    ),
                )}
                rows={rows.map((r) => ({ ...r, program: `${r.department} / ${r.program}` }))}
                caption="ساعات منفذة ومستحقة معتمدة؛ هذا الكشف لا يثبت تنفيذ الدفع"
                primaryColumnLimit={12}
                minWidthClassName="min-w-0"
              />
              <p className="mt-6">
                إعداد: __________ · مراجعة الشؤون الأكاديمية: __________ · اعتماد الأمين العام:
                __________
              </p>
            </div>
          </RepeatingPrintHeader>
        </>
      }
      filename={filename}
      printFilename={filename}
      rows={mode === "report" ? rows : []}
      headers={PAY_HEADERS}
      isLoading={query.isFetching}
      error={query.error ?? (invalidDates ? new Error("بداية الفترة يجب أن تسبق نهايتها") : null)}
      onRetry={() => void query.refetch()}
      filterSummary={summary}
      headerMeta={{
        termName,
        note: `إلى الأخ الأمين العام — ${summary} — كشف مستحقات معتمدة للمراجعة والصرف؛ لا يثبت تنفيذ الدفع.`,
      }}
      emptyMessage={
        !term
          ? "اختر الفصل الدراسي لعرض السجل."
          : mode !== "report"
            ? "استخدم النماذج أعلاه؛ الطباعة والتصدير متاحان في تبويب كشف المستحقات."
            : "لا توجد ساعات معتمدة ماليًا ضمن هذه الفلاتر."
      }
      summary={
        mode === "report" && safe && term ? (
          <Card className="p-4 text-sm leading-7">
            {`إجمالي المستحقات: ${totalLabel} · عدد سجلات التنفيذ المعتمدة: ${rows.length}.`}
            <p>
              إعداد: __________ · مراجعة الشؤون الأكاديمية: __________ · اعتماد الأمين العام:
              __________
            </p>
          </Card>
        ) : undefined
      }
      filters={
        <div className="report-no-print space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="إدارة أجور التدريس">
            {(
              [
                ["report", "كشف المستحقات"],
                ["entries", "إدخال التنفيذ والاعتماد"],
                ["rates", "أسعار الساعات"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                variant={mode === id ? "default" : "outline"}
                onClick={() => {
                  setMode(id);
                  setReview(null);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-sm">
            الكلية: {collegeName} — لتغيير الكلية استخدم محدد الكلية أعلى المنصة.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="الفصل الدراسي">
              <select
                className={controlClass}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setFilter(blankFilter);
                  setReview(null);
                }}
              >
                <option value="">اختر الفصل</option>
                {data?.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="القسم">
              <select
                className={controlClass}
                value={filter.department}
                onChange={(e) => set("department", e.target.value)}
              >
                <option value="">كل الأقسام</option>
                <Options values={departments} />
              </select>
            </Field>
            <Field label="البرنامج">
              <select
                className={controlClass}
                value={filter.program}
                onChange={(e) => set("program", e.target.value)}
              >
                <option value="">كل البرامج</option>
                {programs
                  .filter((p) => !filter.department || p.department_id === filter.department)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="المحاضر">
              <select
                className={controlClass}
                value={filter.instructor}
                onChange={(e) => set("instructor", e.target.value)}
              >
                <option value="">كل المحاضرين</option>
                <Options values={instructors} />
              </select>
            </Field>
            <Field label="النظام">
              <select
                className={controlClass}
                value={filter.system}
                onChange={(e) => set("system", e.target.value)}
              >
                <option value="">العام والموازي</option>
                <Options values={PAY_SYSTEMS} />
              </select>
            </Field>
            <Field label="نوع الاستحقاق">
              <select
                className={controlClass}
                value={filter.kind}
                onChange={(e) => set("kind", e.target.value)}
              >
                <option value="">الزائد والتعاقدي</option>
                <Options values={PAY_KINDS} />
              </select>
            </Field>
            <Field label="من تاريخ">
              <Input
                type="date"
                value={filter.from}
                onChange={(e) => set("from", e.target.value)}
              />
            </Field>
            <Field label="إلى تاريخ">
              <Input type="date" value={filter.to} onChange={(e) => set("to", e.target.value)} />
            </Field>
          </div>
          <Button variant="outline" onClick={() => setFilter(blankFilter)}>
            مسح فلاتر الكشف
          </Button>
          <p className="text-sm leading-7">
            يُدخل التنفيذ من محضر أو كشف معتمد. الساعات المستحقة هي المعتمدة للصرف بعد تسوية النصاب،
            وليست كل ساعات الحضور. المحاضرة المدمجة تُسجل مرة واحدة تحت البرنامج المعتمد لتحميل
            تكلفتها. لا يتم إنشاء مستحقات من الجدول تلقائيًا.
          </p>
          {message && (
            <p role="status" className="text-emerald-700">
              {message}
            </p>
          )}
          {mutationError && (
            <p role="alert" className="text-destructive">
              {mutationError}
            </p>
          )}
          {mode === "rates" && data && safe && (
            <Card className="p-4 space-y-4">
              <h2 className="font-bold">أسعار الجامعة حسب الرتبة والنظام ونوع الاستحقاق</h2>
              <p className="text-sm">
                أدخل السعر وفق القرار المعتمد. كل تعديل إصدار بتاريخ سريان جديد؛ المبالغ المعتمدة
                سابقًا تبقى ثابتة. اختيار «الكل» يطبّق الأجرة نفسها على النوعين أو النظامين؛
                واختياره في الحقلين ينشئ أربعة أسعار للرتبة المحددة دفعة واحدة.
              </p>
              <form
                onSubmit={(e) => void submit(e, "save_rates")}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <Field label="الرتبة العلمية">
                  <select name="rank" className={controlClass} required>
                    <option value="">اختر الرتبة</option>
                    {ACADEMIC_RANKS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="نوع الأجر">
                  <select name="kind" className={controlClass} defaultValue="overload">
                    <option value="all">الكل</option>
                    <Options values={PAY_KINDS} />
                  </select>
                </Field>
                <Field label="نظام الأجر">
                  <select name="system" className={controlClass} defaultValue="regular">
                    <option value="all">الكل</option>
                    <Options values={PAY_SYSTEMS} />
                  </select>
                </Field>
                <Field label="أجرة الساعة">
                  <Input
                    name="hourly_rate"
                    type="number"
                    min="0.01"
                    max="100000000"
                    step="0.01"
                    required
                  />
                </Field>
                <Field label="العملة (رمز من ثلاثة أحرف)">
                  <Input
                    name="currency"
                    placeholder="YER"
                    pattern="[A-Za-z]{3}"
                    maxLength={3}
                    required
                  />
                </Field>
                <Field label="تاريخ سريان السعر">
                  <Input name="effective_from" type="date" required />
                </Field>
                <Field label="مرجع قرار الأجر">
                  <Input name="decision_ref" maxLength={300} required />
                </Field>
                <Button type="submit" disabled={busy} className="self-end">
                  حفظ إصدار السعر
                </Button>
              </form>
              <ReportDataTable
                columns={[
                  { key: "rank", label: "الرتبة" },
                  { key: "kind", label: "النوع" },
                  { key: "system", label: "النظام" },
                  { key: "effective_from", label: "يسري من" },
                  { key: "hourly_rate", label: "السعر" },
                  { key: "currency", label: "العملة" },
                  { key: "decision_ref", label: "القرار" },
                ]}
                rows={data.rates.map((r) => ({
                  ...r,
                  kind: PAY_KINDS[r.kind],
                  system: PAY_SYSTEMS[r.system],
                }))}
                caption="إصدارات أجور الساعات"
                primaryColumnLimit={7}
              />
            </Card>
          )}
          {mode === "entries" && data && safe && term && (
            <Card className="p-4 space-y-4">
              <h2 className="font-bold">تسجيل تنفيذ فعلي مستند إلى اعتماد</h2>
              <ExecutionForm
                key={term}
                data={data}
                busy={busy}
                submit={(e) => void submit(e, "save_execution")}
              />
              <h3 className="font-semibold">
                المسودات بانتظار الاعتماد المالي (
                {entries.filter((e) => e.status === "draft").length})
              </h3>
              {entries
                .filter((e) => e.status === "draft")
                .map((e) => {
                  const rate = applicableRate(e, data.rates);
                  return (
                    <div key={e.id} className="rounded-md border p-3 space-y-2">
                      <p className="font-medium">
                        {e.instructor_name} · {e.rank} · {e.program_name} · {PAY_SYSTEMS[e.system]}
                      </p>
                      <p className="text-sm">
                        {e.work_date} · {e.starts_at.slice(0, 5)}–{e.ends_at.slice(0, 5)} · المنفذ:{" "}
                        {e.actual_hours} ساعة · المستحق: {e.payable_hours} ساعة {PAY_KINDS[e.kind]}{" "}
                        · المرجع: {e.approval_ref}
                      </p>
                      <p className="text-sm">
                        {rate
                          ? `السعر النافذ: ${rate.hourly_rate} ${rate.currency} · المستحق: ${formatNumber(Math.round(e.payable_hours * rate.hourly_rate * 100) / 100)} ${rate.currency}`
                          : "لا يوجد سعر نافذ مطابق؛ يلزم استكمال الأسعار قبل الاعتماد."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={busy || !rate}
                          onClick={() =>
                            rate &&
                            setReview({
                              id: e.id,
                              rateId: rate.id,
                              amount: Math.round(e.payable_hours * rate.hourly_rate * 100) / 100,
                              currency: rate.currency,
                            })
                          }
                        >
                          مراجعة واعتماد
                        </Button>
                        <form
                          className="flex gap-2"
                          onSubmit={async (event) => {
                            event.preventDefault();
                            const fd = new FormData(event.currentTarget);
                            // M-15: voiding a draft is irreversible — ask first.
                            const ok = await confirmAction({
                              title: "إلغاء مسودة التنفيذ؟",
                              description: `سيُلغى سجل ${e.instructor_name} بتاريخ ${e.work_date} نهائيًا مع حفظ أثره، ولا يمكن اعتماده بعد ذلك.`,
                              confirmLabel: "إلغاء المسودة",
                              destructive: true,
                            });
                            if (!ok) return;
                            void mutate("void", {
                              id: e.id,
                              reason: fd.get("reason"),
                            });
                          }}
                        >
                          <Input
                            aria-label={`سبب إلغاء سجل ${e.instructor_name}`}
                            name="reason"
                            placeholder="سبب إلغاء المسودة"
                            maxLength={1000}
                            required
                          />
                          <Button type="submit" variant="outline" disabled={busy}>
                            إلغاء المسودة
                          </Button>
                        </form>
                      </div>
                      {review?.id === e.id && (
                        <div
                          className="rounded bg-primary/5 p-3 space-y-2"
                          role="region"
                          aria-label="تأكيد الاعتماد المالي"
                        >
                          <p>
                            اعتماد {formatNumber(review.amount)} {review.currency} وفق المرجع{" "}
                            {e.approval_ref}؟ سيُقفل السجل والسعر بعد الاعتماد.
                          </p>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void mutate("approve", {
                                id: e.id,
                                rate_id: review.rateId,
                              })
                            }
                          >
                            تأكيد الاعتماد المالي
                          </Button>{" "}
                          <Button variant="outline" onClick={() => setReview(null)}>
                            رجوع
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              <p className="text-sm">
                المعتمد: {entries.filter((e) => e.status === "approved").length} · الملغى:{" "}
                {entries.filter((e) => e.status === "void").length}. السجلات المعتمدة تظهر في كشف
                المستحقات ولا تقبل التعديل.
              </p>
            </Card>
          )}
        </div>
      }
    >
      {mode === "report" && (
        <ReportSection
          title="كشف المستحقات المعتمدة — موجّه للأمين العام"
          count={rows.length}
          bodyClassName="p-0"
        >
          <ReportDataTable
            columns={PAY_HEADERS}
            rows={rows}
            caption="الساعات المنفذة المعتمدة ومستحقاتها"
            primaryColumnLimit={PAY_HEADERS.length}
            minWidthClassName="min-w-[1500px]"
          />
        </ReportSection>
      )}
    </ReportShell>
  );
}
function ExecutionForm({
  data,
  busy,
  submit,
}: {
  data: PayData;
  busy: boolean;
  submit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="المحاضر المنفذ">
        <select name="identity_id" className={controlClass} required>
          <option value="">اختر المحاضر</option>
          {data.instructors.map((i) => (
            <option key={i.id} value={i.id} disabled={!i.kind || !i.rank}>
              {i.name} — {i.rank || "رتبة غير مكتملة"} —{" "}
              {i.kind ? PAY_KINDS[i.kind] : "تصنيف غير مكتمل"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="برنامج التنفيذ">
        <select name="program_id" className={controlClass} required>
          <option value="">اختر البرنامج</option>
          {data.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="نظام التنفيذ">
        <select name="system" className={controlClass}>
          <Options values={PAY_SYSTEMS} />
        </select>
      </Field>
      <Field label="نوع الساعات المستحقة">
        <select name="kind" className={controlClass}>
          <Options values={PAY_KINDS} />
        </select>
      </Field>
      <Field label="تاريخ التنفيذ">
        <Input name="work_date" type="date" required />
      </Field>
      <Field label="بداية التنفيذ">
        <Input name="starts_at" type="time" required />
      </Field>
      <Field label="نهاية التنفيذ">
        <Input name="ends_at" type="time" required />
      </Field>
      <Field label="الساعات المنفذة فعليًا">
        <Input name="actual_hours" type="number" step="0.01" min="0.01" max="24" required />
      </Field>
      <Field label="الساعات المستحقة المعتمدة للصرف">
        <Input name="payable_hours" type="number" step="0.01" min="0.01" max="24" required />
      </Field>
      <Field label="مرجع اعتماد التنفيذ والاستحقاق">
        <Input name="approval_ref" maxLength={300} required />
      </Field>
      <Field label="ملاحظات">
        <Input name="note" maxLength={1000} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
        <input name="certified" type="checkbox" required />
        أؤكد أن التنفيذ والساعات المستحقة معتمدة بالمرجع المذكور، وأن الساعات الزائدة صافية بعد
        تسوية النصاب، وأن المحاضرة المدمجة لم تسجل لدى برنامج آخر.
      </label>
      <Button type="submit" disabled={busy}>
        حفظ للمراجعة المالية
      </Button>
    </form>
  );
}
