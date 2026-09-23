import type { CollegeRef } from "@/hooks/use-colleges";
import type { FacultyHome } from "./faculty-workflow";
import { RECONCILE_EVIDENCE_MIN } from "./faculty-workflow";

export function collegeCorrectionTargets(profile: FacultyHome, colleges: readonly CollegeRef[]) {
  const source = profile.members.find((member) => member.id === profile.source_instructor_id);
  const university = colleges.find((college) => college.id === source?.college_id)?.university_id;
  return university
    ? colleges.filter(
        (college) => college.university_id === university && college.id !== profile.home_college_id,
      )
    : [];
}

export function collegeCorrectionPayload(input: {
  canCorrect: boolean;
  instructorId: string;
  profile: FacultyHome;
  colleges: readonly CollegeRef[];
  targetCollegeId: string;
  evidence: string;
  quotaConfirmed: boolean;
  confirmed: boolean;
}) {
  const { profile } = input;
  if (!input.canCorrect) throw new Error("نقل المحاضر متاح للمشرف العام فقط.");
  if (!profile.members.some((member) => member.id === input.instructorId))
    throw new Error("تغيّرت هوية المحاضر. أعد فتح النافذة.");
  const source = profile.members.find((member) => member.id === profile.source_instructor_id);
  if (!source) throw new Error("تعذر تحديد السجل المعتمد للمحاضر. راجع تسوية التبعية أولًا.");
  if (
    !collegeCorrectionTargets(profile, input.colleges).some((c) => c.id === input.targetCollegeId)
  )
    throw new Error("اختر كلية أخرى من كليات الجامعة.");
  if (input.evidence.trim().length < RECONCILE_EVIDENCE_MIN)
    throw new Error(`اكتب سبب التصحيح في ${RECONCILE_EVIDENCE_MIN} أحرف على الأقل.`);
  if (input.quotaConfirmed && source.recorded_quota == null)
    throw new Error("النصاب غير مسجّل؛ لا يمكن اعتماده أثناء النقل.");
  if (!input.confirmed) throw new Error("راجع الكلية الجديدة وأكد نقل المحاضر إليها.");
  return {
    p_identity_id: profile.identity_id,
    p_home_college_id: input.targetCollegeId,
    p_source_instructor_id: source.id,
    p_quota_confirmed: input.quotaConfirmed,
    p_evidence: input.evidence.trim(),
    p_expected_decision_at: profile.decision_at,
  };
}
