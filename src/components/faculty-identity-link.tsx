import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import { facultyClient, withUniversityNumbers } from "@/lib/instructors/university-number";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function FacultyIdentityLink({
  instructorId,
  name,
}: {
  instructorId: string;
  name: string;
}) {
  const { data: me } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [evidence, setEvidence] = useState("");
  const qc = useQueryClient();
  const candidates = useQuery({
    queryKey: ["faculty-identity-link-candidates", instructorId],
    enabled: open && !!me?.isSuperAdmin,
    queryFn: async () => {
      const rows: {
        id: string;
        full_name: string;
        college_id: string;
        specialization: string | null;
        employee_number: string | null;
      }[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("instructors")
          .select("id, full_name, college_id, specialization, employee_number")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      const { data: colleges, error } = await supabase.from("colleges").select("id,name");
      if (error) throw error;
      return withUniversityNumbers(
        rows
          .filter((row) => row.id !== instructorId)
          .map((row) => ({
            ...row,
            colleges: colleges?.find((c) => c.id === row.college_id),
          })),
      );
    },
  });

  const candidateRows = (candidates.data ?? []).filter((row) => row.university_number);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("ar");
  const filteredCandidates =
    normalizedSearch.length === 0
      ? candidateRows
      : candidateRows.filter((row) =>
          [
            row.full_name,
            row.university_number,
            row.employee_number,
            row.colleges?.name,
            row.specialization,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase("ar").includes(normalizedSearch),
            ),
        );
  const evidenceLength = evidence.trim().length;
  const evidenceReady = evidenceLength >= 12;

  const submitLink = () => {
    if (!target) {
      toast.error("اختر السجل المعتمد أولًا.");
      return;
    }
    if (!confirmed) {
      toast.error("أكد أن السجلين يعودان لنفس الشخص.");
      return;
    }
    if (!evidenceReady) {
      toast.error(`أدخل دليل تحقق واضحًا من 12 حرفًا على الأقل. الحالي: ${evidenceLength}/12`);
      return;
    }
    link.mutate();
  };


  const link = useMutation({
    mutationFn: async () => {
      if (!confirmed || !target || evidence.trim().length < 12)
        throw new Error("اختر السجل وسجل دليل التحقق من هوية المحاضر");
      const { error } = await facultyClient.rpc("link_faculty_identity_with_evidence", {
        p_instructor_id: instructorId,
        p_university_number: target,
        p_evidence: evidence.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instructors"] });
      void qc.invalidateQueries({ queryKey: ["report-instructor-directory"] });
      void qc.invalidateQueries({ queryKey: ["is-ins"] });
      void qc.invalidateQueries({
        queryKey: ["faculty-identity-link-candidates"],
      });
      void qc.invalidateQueries({ queryKey: ["faculty-university-report"] });
      void qc.invalidateQueries({ queryKey: ["faculty-university-choices"] });
      setOpen(false);
      setConfirmed(false);
      setTarget("");
      setSearchQuery("");
      setEvidence("");
      toast.success("تم توحيد الهوية الجامعية مع الحفاظ على الإسنادات والجداول");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!me?.isSuperAdmin) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSearchQuery("");
          setTarget("");
          setConfirmed(false);
          setEvidence("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          ربط الهوية الجامعية
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>ربط سجل {name} بنفس المحاضر</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          اختر السجل المعتمد لنفس الشخص. سيُستخدم رقمه الجامعي للسجلات المرتبطة، مع الاحتفاظ
          بالأرقام السابقة والإسنادات والجداول.
        </p>
        <label className="space-y-1">
          <span>بحث عن المحاضر</span>
          <input
            type="search"
            aria-label="البحث في سجلات المحاضرين"
            className="w-full rounded border p-2"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="اكتب جزءًا من الاسم أو الرقم الجامعي أو رقم الموظف"
            autoComplete="off"
          />
          {normalizedSearch && (
            <span className="block text-xs text-muted-foreground">
              {filteredCandidates.length} نتيجة مطابقة
            </span>
          )}
        </label>
        <label>
          السجل المعتمد
          <select
            aria-label="السجل المعتمد للهوية الجامعية"
            className="w-full rounded border p-2"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">
              {candidates.isLoading
                ? "جارٍ تحميل المحاضرين..."
                : filteredCandidates.length === 0 && normalizedSearch
                  ? "لا توجد نتائج مطابقة"
                  : "اختر المحاضر ورقمه الجامعي"}
            </option>
            {filteredCandidates.map((row) => (
              <option key={row.id} value={row.university_number!}>
                {row.full_name} — {row.university_number} — {row.colleges?.name} —{" "}
                {row.specialization ?? "تخصص غير محدد"} — {row.employee_number}
              </option>
            ))}
          </select>
        </label>
        {candidates.error && <p role="alert">تعذر تحميل السجلات. أعد فتح النافذة للمحاولة.</p>}
        <label className="space-y-1">
          <span>
            دليل التحقق من الهوية <span className="text-destructive">*</span>
          </span>
          <textarea
            required
            minLength={12}
            aria-describedby="faculty-identity-evidence-help"
            aria-invalid={evidenceLength > 0 && !evidenceReady}
            className="w-full rounded border p-2"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="مثال: مطابق للرقم الوظيفي 12345 في كشف شؤون الموظفين."
          />
          <span
            id="faculty-identity-evidence-help"
            className={`block text-xs ${evidenceLength > 0 && !evidenceReady ? "text-destructive" : "text-muted-foreground"}`}
          >
            إلزامي — اكتب مرجع التحقق في 12 حرفًا على الأقل. {evidenceLength}/12
          </span>
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          تحققت أن السجلين لنفس الشخص، وليس مجرد تشابه أسماء.
        </label>
        <Button
          disabled={link.isPending || candidates.isLoading}
          onClick={submitLink}
        >
          {link.isPending ? "جارٍ ربط الهوية..." : "تأكيد ربط الهوية"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
