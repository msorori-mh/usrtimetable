import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAccessibleColleges } from "@/hooks/use-colleges";
import { facultyWorkflow, reconcileErrorMessage } from "@/lib/instructors/faculty-workflow";
import {
  collegeCorrectionPayload,
  collegeCorrectionTargets,
} from "@/lib/instructors/college-correction";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function FacultyCollegeTransfer({
  instructorId,
  collegeId,
  onTransferred,
  onBusyChange,
}: {
  instructorId: string;
  collegeId: string;
  onTransferred: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { data: me } = useCurrentUser();
  const colleges = useAccessibleColleges();
  const qc = useQueryClient();
  const [target, setTarget] = useState("");
  const [evidence, setEvidence] = useState("");
  const [quota, setQuota] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const homes = useQuery({
    queryKey: ["faculty-home-profiles", collegeId],
    enabled: !!me?.isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await facultyWorkflow.rpc("get_faculty_home_profiles", {
        p_college_id: collegeId,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });
  const matches =
    homes.data?.filter((home) => home.members.some((member) => member.id === instructorId)) ?? [];
  const profile = matches.length === 1 ? matches[0] : undefined;
  const targets = profile ? collegeCorrectionTargets(profile, colleges.data ?? []) : [];
  const destination = targets.find((college) => college.id === target);
  const source = profile?.members.find((member) => member.id === profile.source_instructor_id);
  // A changed decision, destination, source quota or reason requires fresh confirmation.
  const review = JSON.stringify([
    instructorId,
    profile?.identity_id,
    profile?.home_college_id,
    profile?.source_instructor_id,
    profile?.decision_at,
    source?.recorded_quota,
    source?.recorded_release,
    target,
    quota,
    evidence.trim(),
  ]);
  const confirmed = confirmation === review;
  const refreshing = homes.isFetching || colleges.isFetching;
  const failed = !!homes.error || !!colleges.error;
  let blocked: string | null = null;
  try {
    if (!profile) throw new Error("تعذر تحديد الهوية الجامعية لهذا السجل.");
    collegeCorrectionPayload({
      canCorrect: !!me?.isSuperAdmin,
      instructorId,
      profile,
      colleges: colleges.data ?? [],
      targetCollegeId: target,
      evidence,
      quotaConfirmed: quota,
      confirmed,
    });
  } catch (error) {
    blocked = error instanceof Error ? error.message : "راجع بيانات النقل.";
  }
  const transfer = useMutation({
    mutationFn: async () => {
      if (refreshing || failed || !profile)
        throw new Error("انتظر اكتمال التحقق من بيانات المحاضر.");
      const payload = collegeCorrectionPayload({
        canCorrect: !!me?.isSuperAdmin,
        instructorId,
        profile,
        colleges: colleges.data ?? [],
        targetCollegeId: target,
        evidence,
        quotaConfirmed: quota,
        confirmed,
      });
      const { error } = await facultyWorkflow.rpc("reconcile_faculty_home", payload);
      if (error) throw new Error(reconcileErrorMessage(error.message));
    },
    onMutate: () => {
      setSaveError(null);
      onBusyChange(true);
    },
    onSuccess: () => {
      // Home affiliation affects directories, report attribution and leadership totals.
      void qc.invalidateQueries();
      toast.success(
        `تم نقل المحاضر إلى ${destination?.name ?? "الكلية الجديدة"} مع حفظ رقمه الجامعي وإسناداته`,
      );
      onTransferred();
    },
    onError: (error: Error) => {
      setSaveError(error.message);
      setConfirmation(null);
    },
    onSettled: () => onBusyChange(false),
  });

  if (!me?.isSuperAdmin) return null;
  if (homes.isLoading || colleges.isLoading)
    return <p role="status">جارٍ تحميل بيانات المحاضر والكليات…</p>;
  if (failed || !profile)
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>تعذر التحقق من الكلية الحالية والهوية الجامعية. أعد تحميل البيانات قبل النقل.</p>
        <Button
          variant="outline"
          disabled={refreshing}
          onClick={() => {
            setConfirmation(null);
            void homes.refetch();
            void colleges.refetch();
          }}
        >
          إعادة تحميل البيانات
        </Button>
      </div>
    );
  return (
    <div className="space-y-4 text-sm" data-testid="faculty-college-transfer">
      <p>
        لتصحيح كلية أُدخل فيها المحاضر بالخطأ. سيظهر ضمن أعضاء الكلية الجديدة، وتبقى محاضراته
        الحالية في كلياتها ومواعيدها.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-lg bg-muted/50 p-3">
        <dt>المحاضر</dt>
        <dd className="font-semibold">{profile.name}</dd>
        <dt>الرقم الجامعي</dt>
        <dd dir="ltr" className="text-right">
          {profile.university_number}
        </dd>
        <dt>الكلية الحالية</dt>
        <dd>{profile.home_college ?? "التبعية تحتاج مراجعة"}</dd>
      </dl>
      <label className="block space-y-1">
        <span>الكلية الصحيحة</span>
        <select
          aria-label="الكلية الصحيحة للمحاضر"
          className="w-full rounded border bg-background p-2"
          value={target}
          disabled={transfer.isPending || refreshing}
          onChange={(event) => {
            setTarget(event.target.value);
            setConfirmation(null);
            setQuota(false);
            setSaveError(null);
          }}
        >
          <option value="">اختر الكلية المنقول إليها</option>
          {targets.map((college) => (
            <option key={college.id} value={college.id}>
              {college.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-muted-foreground">
        بعد النقل، استكمل القسم من بيانات المحاضر في كليته الجديدة. لا يُنقل قسم الكلية السابقة
        إليها.
      </p>
      {profile.members.length > 1 && (
        <p>
          يشمل التصحيح جميع سجلات هذه الهوية المرتبطة ({profile.members.length})، مع بقاء الإسنادات
          والجدول الجامعي الموحّد محفوظين.
        </p>
      )}
      <label className="block space-y-1">
        <span>سبب تصحيح الكلية</span>
        <textarea
          aria-label="سبب تصحيح كلية المحاضر"
          className="w-full rounded border bg-background p-2"
          value={evidence}
          disabled={transfer.isPending}
          onChange={(event) => setEvidence(event.target.value)}
          placeholder="وضح الكلية الصحيحة وسبب الإدخال السابق بالخطأ"
        />
      </label>
      <div className="space-y-2 rounded-lg border p-3">
        <p>
          النصاب المسجّل: {source?.recorded_quota ?? "غير محدد"} · الإعفاء:{" "}
          {source?.recorded_release ?? 0} ساعة أسبوعيًا.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={quota}
            disabled={transfer.isPending || source?.recorded_quota == null}
            onChange={(event) => setQuota(event.target.checked)}
          />
          <span>أؤكد صحة النصاب المسجّل واعتماده في الكلية الجديدة.</span>
        </label>
        <p className="text-muted-foreground">
          دون هذا التأكيد، تُحفظ الساعات المسجّلة ويبقى اعتماد النصاب وحساب الزيادة والعجز معلّقًا
          للمراجعة.
        </p>
      </div>
      {destination && (
        <p
          className="rounded-lg border border-primary/30 bg-primary/5 p-3 font-medium"
          role="status"
        >
          النقل من {profile.home_college ?? "تبعية غير محددة"} إلى {destination.name}.
        </p>
      )}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={transfer.isPending || refreshing || !destination}
          onChange={(event) => setConfirmation(event.target.checked ? review : null)}
        />
        <span>راجعت البيانات وأؤكد أن الكلية المختارة هي الكلية الصحيحة للمحاضر.</span>
      </label>
      {blocked && !transfer.isPending && (
        <p className="text-muted-foreground" aria-live="polite">
          {blocked}
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-destructive">
          {saveError}
        </p>
      )}
      <Button
        disabled={transfer.isPending || refreshing || blocked !== null}
        onClick={() => {
          if (blocked === null && !transfer.isPending && !refreshing) transfer.mutate();
        }}
      >
        {transfer.isPending ? "جارٍ نقل المحاضر…" : "تأكيد نقل المحاضر"}
      </Button>
    </div>
  );
}
