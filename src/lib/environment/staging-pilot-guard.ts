/** Fail-closed identity gate for disposable scheduling pilots. */

export const PRODUCTION_SUPABASE_PROJECT_REFS = new Set([
  "emzytxqkxjjhsivqxdiu",
]);

export const PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID =
  "835e50fe-3ad2-4232-8c15-0f403c668a7f";

export type StagingPilotIdentity = {
  projectRef: string | null | undefined;
  scheduleVersionId: string;
  scheduleVersionStatus: string;
  disposableTest: boolean;
};

export type StagingPilotGate =
  | { ok: true; environment: "isolated_staging"; cleanupRequired: true }
  | {
      ok: false;
      code:
        | "PILOT_PROJECT_REF_MISSING"
        | "PILOT_PRODUCTION_PROJECT_BLOCKED"
        | "PILOT_PROTECTED_VERSION_BLOCKED"
        | "PILOT_VERSION_NOT_DRAFT"
        | "PILOT_VERSION_NOT_DISPOSABLE";
      messageAr: string;
    };

/**
 * This gate must run before any staging pilot write.
 * A source label or document saying "staging" is never sufficient: the actual
 * runtime project ref and disposable draft marker are authoritative.
 */
export function assertIsolatedStagingPilot(input: StagingPilotIdentity): StagingPilotGate {
  const projectRef = input.projectRef?.trim();
  if (!projectRef) {
    return {
      ok: false,
      code: "PILOT_PROJECT_REF_MISSING",
      messageAr: "تعذر إثبات هوية بيئة الاختبار؛ أُوقف التشغيل دون كتابة.",
    };
  }
  if (PRODUCTION_SUPABASE_PROJECT_REFS.has(projectRef)) {
    return {
      ok: false,
      code: "PILOT_PRODUCTION_PROJECT_BLOCKED",
      messageAr: "مرجع المشروع يخص الإنتاج؛ يُمنع تشغيل التجربة عليه.",
    };
  }
  if (input.scheduleVersionId === PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID) {
    return {
      ok: false,
      code: "PILOT_PROTECTED_VERSION_BLOCKED",
      messageAr: "نسخة الجدول المحمية لا يجوز استخدامها كتجربة.",
    };
  }
  if (input.scheduleVersionStatus !== "draft") {
    return {
      ok: false,
      code: "PILOT_VERSION_NOT_DRAFT",
      messageAr: "تجربة الجدولة مسموحة على نسخة مسودة فقط.",
    };
  }
  if (!input.disposableTest) {
    return {
      ok: false,
      code: "PILOT_VERSION_NOT_DISPOSABLE",
      messageAr: "النسخة غير موسومة كتجربة قابلة للتنظيف؛ أُوقف التشغيل.",
    };
  }
  return { ok: true, environment: "isolated_staging", cleanupRequired: true };
}
