import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAccessibleColleges } from "@/hooks/use-colleges";
import {
  facultyWorkflow,
  facultyStatusLabel,
  reconcileBlockReason,
  reconcileErrorMessage,
  type FacultyHome,
} from "@/lib/instructors/faculty-workflow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export { FacultyTeachingRequests } from "@/components/faculty-teaching-requests";

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
  const [saveError, setSaveError] = useState<string | null>(null);
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
        p_evidence: evidence.trim(),
        p_expected_decision_at: edit.decision_at,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تمت تسوية التبعية ومصدر النصاب");
      setSaveError(null);
      setEdit(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => {
      const msg = reconcileErrorMessage(e.message);
      setSaveError(msg);
      toast.error(msg);
    },
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
                            setSaveError(null);
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
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
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
          {(() => {
            const blocked = reconcileBlockReason({
              canReconcile: !!me?.isSuperAdmin,
              busy: save.isPending,
              home,
              source,
              sourceIds: edit?.members.map((m) => m.id) ?? [],
              evidence,
            });
            return (
              <>
                <Button
                  disabled={blocked !== null}
                  onClick={() => {
                    if (blocked !== null || save.isPending) return;
                    setSaveError(null);
                    save.mutate();
                  }}
                >
                  {save.isPending ? "جارٍ الحفظ…" : "اعتماد التسوية"}
                </Button>
                {blocked && !save.isPending && (
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {blocked}
                  </p>
                )}
                {saveError && (
                  <p role="alert" className="text-sm text-destructive">
                    {saveError}
                  </p>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </section>
  );
}
