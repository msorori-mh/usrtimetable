import { useQuery } from "@tanstack/react-query";
import { SelectItem } from "@/components/ui/select";
import { DAYS } from "@/routes/_authenticated/time-slots";
import { ALL_ACTIVE_DAYS_SENTINEL, DEFAULT_WORKING_DAYS, resolveWorkingDays } from "@/lib/availability/active-days";
import { fetchCollegeWorkingDays } from "@/lib/availability/bulk-api";
import { readableWriteError } from "@/lib/availability/errors";
import { userErrorMessage } from "@/lib/user-error";

/** Shared helpers for the availability policy centre (split from routes/_authenticated/availability.tsx). */
export function rpcErrorMessage(e: unknown): string {
  // LAUNCH-CLOSURE-01: the previous shape stringified any non-Error rejection, which renders
  // as the literal "[object Object]", and for a real PostgrestError it printed only `message`
  // and dropped `hint` and `details` — yet PostgREST puts the actionable cause in `hint`.
  // `readableWriteError` keeps all three and can never produce "[object Object]".
  const msg = readableWriteError(e);
  const overlap =
    msg.match(/availability_overlap:\s*day=(\d+)/i) ??
    msg.match(/unavailability_overlap:\s*day=(\d+)/i);
  if (overlap) {
    const day = Number(overlap[1]);
    const dayLabel = DAYS[day] ?? `اليوم ${day}`;
    return `تعارض في ${dayLabel}: تم رفض العملية بالكامل (لا تطبيق جزئي). ${msg}`;
  }
  if (/invalid_time_range/i.test(msg)) {
    return "وقت النهاية يجب أن يكون بعد البداية.";
  }
  if (/college access denied|42501/i.test(msg)) {
    return "ليس لديك صلاحية لإدارة هذه الكلية.";
  }
  if (/authentication required/i.test(msg)) {
    return "يجب تسجيل الدخول أولاً.";
  }
  return userErrorMessage(e);
}

export function useWorkingDays(collegeId: string | undefined) {
  return useQuery({
    queryKey: ["scheduling-working-days", collegeId],
    enabled: !!collegeId,
    queryFn: () => fetchCollegeWorkingDays(collegeId!),
    staleTime: 60_000,
  });
}

export function AffectedDaysPreview({
  dayValue,
  workingDays,
}: {
  dayValue: string;
  workingDays: number[] | undefined;
}) {
  const days = resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS);
  const count = dayValue === ALL_ACTIVE_DAYS_SENTINEL ? days.length : 1;
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="affected-days-preview">
      سيتم تطبيق الفترة على {count} {count === 1 ? "يوم" : "أيام"}.
    </p>
  );
}

/** Day options from operational calendar (scheduling_settings.working_days) — never hardcoded week. */
export function DaySelectItems({ workingDays }: { workingDays: number[] | undefined }) {
  const activeDays = resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS);
  return (
    <>
      <SelectItem value={ALL_ACTIVE_DAYS_SENTINEL}>كل أيام الدوام</SelectItem>
      {activeDays.map((day) => (
        <SelectItem key={day} value={String(day)}>
          {DAYS[day] ?? `اليوم ${day}`}
        </SelectItem>
      ))}
    </>
  );
}
