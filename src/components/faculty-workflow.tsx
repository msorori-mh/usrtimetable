import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAccessibleColleges } from "@/hooks/use-colleges";
import { mapAssignmentRpcError } from "@/lib/academic-delivery/teaching-assignments-v2";
import {
  facultyWorkflow,
  facultyStatusLabel,
  requestStatusLabel,
  type FacultyHome,
} from "@/lib/instructors/faculty-workflow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const inputClass = "w-full rounded border bg-background p-2";
export function FacultyHomeReview({ collegeId }: { collegeId: string }) {
  const { data: me } = useCurrentUser();
  const { data: colleges } = useAccessibleColleges();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<FacultyHome | null>(null);
  const [home, setHome] = useState("");
  const [source, setSource] = useState("");
  const [evidence, setEvidence] = useState("");
  const [quota, setQuota] = useState(false);
  const list = useQuery({
    queryKey: ["faculty-home-profiles", collegeId],
    queryFn: async () => {
      const { data, error } = await facultyWorkflow.rpc("get_faculty_home_profiles", {
        p_college_id: collegeId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!edit) throw new Error("اختر المحاضر");
      const { error } = await facultyWorkflow.rpc("reconcile_faculty_home", {
        p_identity_id: edit.identity_id,
        p_home_college_id: home,
        p_source_instructor_id: source,
        p_quota_confirmed: quota,
        p_evidence: evidence,
        p_expected_decision_at: edit.decision_at,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تمت تسوية التبعية ومصدر النصاب");
      setEdit(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(mapAssignmentRpcError(e.message).message),
  });
  const rows = list.data ?? [];
  return (
    <section className="my-4 space-y-3 rounded border p-4" dir="rtl">
      <h2 className="font-bold">التبعية الأصلية ومصدر النصاب</h2>
      <p className="text-sm">
        أعضاء الكلية: {rows.filter((r) => r.home_college_id === collegeId).length} · سجلات من كليات
        أخرى: {rows.filter((r) => r.home_college_id && r.home_college_id !== collegeId).length} ·
        تحتاج مراجعة: {rows.filter((r) => !r.home_college_id).length}
      </p>
      <p className="text-sm text-muted-foreground">
        إضافة المحاضر تكون في كليته الأصلية. لتدريسه في كلية أخرى استخدم طلب التكليف في الإسناد
        التدريسي.
      </p>
      {list.error && (
        <p role="alert" className="text-destructive">
          تعذر تحميل التبعية: {list.error.message}
        </p>
      )}
      <details>
        <summary className="cursor-pointer">استعراض التبعية وتسوية السجلات الحالية</summary>
        <input
          className={inputClass + " my-3"}
          aria-label="بحث في تبعية المحاضرين"
          placeholder="اسم المحاضر أو رقمه الجامعي"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr>
                {["المحاضر", "الكلية الأصلية", "النصاب المعتمد", "الحالة", ""].map((v, i) => (
                  <th className="p-2" key={i}>
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => [r.name, r.university_number].join(" ").includes(search))
                .map((r) => (
                  <tr key={r.identity_id} className="border-t">
                    <td className="p-2">
                      {r.name}
                      <div dir="ltr" className="text-xs">
                        {r.university_number}
                      </div>
                    </td>
                    <td className="p-2">{r.home_college ?? "تحتاج مراجعة"}</td>
                    <td className="p-2">{r.quota ?? "بانتظار الاعتماد"}</td>
                    <td className="p-2">{facultyStatusLabel[r.status]}</td>
                    <td>
                      {me?.isSuperAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEdit(r);
                            setHome(r.home_college_id ?? "");
                            setSource(r.source_instructor_id ?? "");
                            setQuota(false);
                            setEvidence("");
                          }}
                        >
                          تسوية
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEdit(null);
        }}
      >
        <DialogContent dir="rtl">
          <DialogTitle>تسوية تبعية {edit?.name}</DialogTitle>
          <DialogDescription>
            حدد الكلية الأصلية والسجل المعتمد لبيانات المحاضر. يحتفظ النظام بالإسنادات والمواعيد
            والمجموعات والرقم الجامعي.
          </DialogDescription>
          <label>
            الكلية الأصلية
            <select className={inputClass} value={home} onChange={(e) => setHome(e.target.value)}>
              <option value="">اختر الكلية</option>
              {colleges?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            مصدر بيانات المحاضر والنصاب
            <select
              className={inputClass}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setQuota(false);
              }}
            >
              <option value="">اختر السجل</option>
              {edit?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.college} — نصاب {m.recorded_quota ?? "غير محدد"}، إعفاء{" "}
                  {m.recorded_release ?? 0}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={quota} onChange={(e) => setQuota(e.target.checked)} />
            أؤكد اعتماد نصاب هذا السجل من الكلية الأصلية
          </label>
          <p className="text-sm">
            اترك التأكيد دون تحديد إذا كانت بيانات النصاب غير موثقة؛ سيبقى حساب الزيادة والعجز
            معلّقًا.
          </p>
          <label>
            مرجع التحقق
            <textarea
              className={inputClass}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="مصدر تأكيد التبعية والنصاب"
            />
          </label>
          <Button
            disabled={save.isPending || !home || !source || evidence.trim().length < 10}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "جارٍ الحفظ…" : "اعتماد التسوية"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function FacultyTeachingRequests({ collegeId }: { collegeId: string }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<{
    id: string;
    action: string;
  } | null>(null);
  const [note, setNote] = useState("");
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
  const save = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error("اختر الطلب");
      const { error } = await facultyWorkflow.rpc("decide_faculty_teaching_request", {
        p_request_id: decision.id,
        p_decision: decision.action,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ قرار التكليف");
      setDecision(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(mapAssignmentRpcError(e.message).message),
  });
  return (
    <section className="my-4 space-y-3 rounded border p-4" dir="rtl">
      <h2 className="font-bold">طلبات التكليف بين الكليات</h2>
      <p className="text-sm">
        يُحتسب التكليف في النصاب بعد اعتماد الكلية الأصلية. اعتماد الطلب لا يغيّر مواعيد الجداول.
      </p>
      {list.error && (
        <p role="alert" className="text-destructive">
          تعذر تحميل الطلبات: {list.error.message}
        </p>
      )}
      {list.isLoading ? (
        <p>جارٍ تحميل الطلبات…</p>
      ) : list.data?.length === 0 ? (
        <p>لا توجد طلبات تكليف.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr>
                {[
                  "المحاضر",
                  "الأصلية ← المستفيدة",
                  "الفصل والمجموعة",
                  "الساعات",
                  "الحالة",
                  "القرار",
                ].map((v) => (
                  <th className="p-2" key={v}>
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2">
                    {r.home_college} ← {r.college}
                  </td>
                  <td className="p-2">
                    {r.term} — {r.group}
                    {r.is_update ? " — تعديل ساعات" : ""}
                  </td>
                  <td className="p-2">{r.hours}</td>
                  <td className="p-2">
                    {requestStatusLabel[r.status]}
                    <div className="text-xs">{r.decision_note}</div>
                  </td>
                  <td className="p-2">
                    {r.status === "pending" && (
                      <div className="flex gap-2">
                        {(r.can_decide
                          ? [
                              ["approved", "اعتماد"],
                              ["rejected", "رفض"],
                            ]
                          : []
                        )
                          .concat(r.can_cancel ? [["cancelled", "إلغاء"]] : [])
                          .map(([action, label]) => (
                            <Button
                              key={action}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDecision({ id: r.id, action });
                                setNote("");
                              }}
                            >
                              {label}
                            </Button>
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDecision(null);
        }}
      >
        <DialogContent dir="rtl">
          <DialogTitle>قرار طلب التكليف</DialogTitle>
          <DialogDescription>
            سجل مرجع القرار. يعيد النظام فحص المجموعة والتبعية والساعات عند الاعتماد.
          </DialogDescription>
          <textarea
            className={inputClass}
            aria-label="مرجع قرار التكليف"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button disabled={save.isPending || note.trim().length < 3} onClick={() => save.mutate()}>
            حفظ القرار
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
