import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { logAudit } from "@/lib/audit";
import { DAYS } from "./time-slots";
import {
  ALL_ACTIVE_DAYS_SENTINEL,
  DEFAULT_WORKING_DAYS,
  groupIdenticalWindows,
  isValidTimeRange,
  resolveWorkingDays,
} from "@/lib/availability/active-days";
import { fetchCollegeWorkingDays } from "@/lib/availability/bulk-api";

export const Route = createFileRoute("/_authenticated/instructor-preferences")({
  head: () => ({ meta: [{ title: "تفضيلات المحاضرين" }] }),
  component: InstructorPreferencesPage,
});

/**
 * A3.3 — Soft scheduling preferences for instructors (تفضيلات ناعمة Soft فقط).
 * Writes instructor_availability rows with is_preference=true ONLY:
 *   availability_type='available'   → preferred window (مفضّلة)     → solver: +5 inside / −3 outside
 *   availability_type='unavailable' → not-preferred window (غير مفضّلة) → solver: −10 on overlap
 * (see src/lib/auto-scheduler/greedy.ts — candidate scoring).
 *
 * Independence contract (binding):
 * - Never mixed into the unavailability (Hard) screen and never reads/writes
 *   is_preference=false rows here. Hard blocks stay in /availability.
 * - Independent from structural constraints; preferences never block scheduling.
 * - Does NOT use the source-only bulk unavailability RPCs (upsert_instructor_unavailability_*)
 *   — plain college-scoped table insert/delete under existing RLS (can_manage_college).
 */

type PrefKind = "available" | "unavailable";

const KIND_LABELS: Record<PrefKind, string> = {
  available: "فترة مفضّلة",
  unavailable: "فترة غير مفضّلة",
};

interface IPref {
  id: string;
  instructor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  availability_type: string;
  notes: string | null;
}

function useWorkingDays(collegeId: string | undefined) {
  return useQuery({
    queryKey: ["scheduling-working-days", collegeId],
    enabled: !!collegeId,
    queryFn: () => fetchCollegeWorkingDays(collegeId!),
    staleTime: 60_000,
  });
}

function InstructorPreferencesPage() {
  const { active } = useActiveCollege();
  return (
    <div className="mx-auto max-w-5xl" data-testid="instructor-preferences-page">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Star className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">تفضيلات المحاضرين</h1>
          <p className="text-sm text-muted-foreground">
            تفضيلات زمنية ناعمة (Soft) للمحاضرين خلال أيام وفترات الدوام — لا تمنع الجدولة، بل
            تؤثر فقط في ترتيب الفترات المرشحة عند الجدولة التلقائية.
          </p>
        </div>
      </header>

      <Card
        className="mb-4 border-primary/30 bg-primary/5 p-4 text-sm"
        data-testid="soft-prefs-semantics-note"
      >
        <p className="font-semibold">كيف تؤثر هذه التفضيلات؟</p>
        <p className="mt-1 text-muted-foreground">
          فترة مفضّلة: +5 عند وقوع الفترة داخلها و−3 خارجها · فترة غير مفضّلة: −10 عند التداخل
          معها. هذه تفضيلات ناعمة مستقلة تمامًا عن عدم التوفر (Hard) وعن القيود الهيكلية، ولا
          تُنتج أي تعارض ولا تمنع أي جلسة.
        </p>
        <p className="mt-1 text-muted-foreground">
          لتسجيل المنع الإلزامي (Hard) استخدم شاشة{" "}
          <Link to="/availability" className="text-primary underline">
            عدم التوفّر
          </Link>
          .
        </p>
      </Card>

      <div className="mb-4">
        <CollegeSwitcher />
      </div>

      {!active ? (
        <p className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          اختر كلّية أولاً.
        </p>
      ) : (
        <InstructorSoftPreferences />
      )}
    </div>
  );
}

function InstructorSoftPreferences() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [instructorId, setInstructorId] = useState("");
  const [form, setForm] = useState<{
    kind: PrefKind;
    dayValue: string;
    start_time: string;
    end_time: string;
    notes: string;
  }>({
    kind: "available",
    dayValue: ALL_ACTIVE_DAYS_SENTINEL,
    start_time: "08:00",
    end_time: "12:00",
    notes: "",
  });
  const { data: workingDays } = useWorkingDays(active?.id);

  const { data: instructors } = useQuery({
    queryKey: ["instr-all", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("instructors")
          .select("id, full_name")
          .eq("college_id", active!.id)
          .order("full_name")
      ).data ?? [],
  });

  // Soft preferences ONLY — hard unavailability rows (is_preference=false) are never read here.
  const { data: rows } = useQuery({
    queryKey: ["instructor-soft-prefs", active?.id, instructorId],
    enabled: !!active && !!instructorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructor_availability")
        .select("*")
        .eq("college_id", active!.id)
        .eq("instructor_id", instructorId)
        .eq("is_preference", true)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as IPref[];
    },
  });

  const activeDays = resolveWorkingDays(workingDays ?? DEFAULT_WORKING_DAYS);

  const groupedPreferred = useMemo(
    () =>
      groupIdenticalWindows(
        (rows ?? []).filter((r) => r.availability_type !== "unavailable"),
        activeDays,
      ),
    [rows, activeDays],
  );
  const groupedAvoided = useMemo(
    () =>
      groupIdenticalWindows(
        (rows ?? []).filter((r) => r.availability_type === "unavailable"),
        activeDays,
      ),
    [rows, activeDays],
  );

  const add = useMutation({
    mutationFn: async () => {
      if (!active || !instructorId) throw new Error("اختر محاضراً");
      if (!isValidTimeRange(form.start_time, form.end_time)) {
        throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      }
      const targetDays =
        form.dayValue === ALL_ACTIVE_DAYS_SENTINEL ? activeDays : [Number(form.dayValue)];

      // Idempotent: skip days that already have an identical preference row.
      const { data: existing, error: exErr } = await supabase
        .from("instructor_availability")
        .select("day_of_week, start_time, end_time, availability_type, notes")
        .eq("college_id", active.id)
        .eq("instructor_id", instructorId)
        .eq("is_preference", true);
      if (exErr) throw exErr;
      const existingKeys = new Set(
        (existing ?? []).map(
          (r) =>
            `${r.day_of_week}|${String(r.start_time).slice(0, 5)}|${String(r.end_time).slice(0, 5)}|${r.availability_type}|${r.notes ?? ""}`,
        ),
      );
      const toInsert = targetDays
        .filter(
          (day) =>
            !existingKeys.has(
              `${day}|${form.start_time}|${form.end_time}|${form.kind}|${form.notes || ""}`,
            ),
        )
        .map((day) => ({
          college_id: active.id,
          instructor_id: instructorId,
          day_of_week: day,
          start_time: form.start_time,
          end_time: form.end_time,
          availability_type: form.kind,
          is_preference: true as const,
          notes: form.notes || null,
        }));

      const skipped = targetDays.length - toInsert.length;
      if (toInsert.length === 0) {
        return { created: 0, skipped };
      }
      // Single array INSERT = one statement (atomic across the targeted days).
      const { data, error } = await supabase
        .from("instructor_availability")
        .insert(toInsert)
        .select("id");
      if (error) throw error;
      await logAudit({
        action: "create",
        entity: "instructor_availability_preference",
        entityId: (data ?? [])[0]?.id,
        collegeId: active.id,
      });
      return { created: (data ?? []).length, skipped };
    },
    onSuccess: (result) => {
      if (result.created === 0 && result.skipped > 0) {
        toast.info("التفضيل موجود مسبقًا — لم يُضف شيء");
      } else {
        toast.success(
          `أُضيف التفضيل إلى ${result.created} ${result.created === 1 ? "يوم" : "أيام"}` +
            (result.skipped > 0 ? ` (تخطّي ${result.skipped} موجودًا مسبقًا)` : ""),
        );
      }
      qc.invalidateQueries({ queryKey: ["instructor-soft-prefs", active?.id, instructorId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("instructor_availability").delete().eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "instructor_availability_preference",
        entityId: id,
        collegeId: active?.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["instructor-soft-prefs", active?.id, instructorId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renderGroup = (
    grouped: ReturnType<typeof groupIdenticalWindows<IPref>>,
    kind: PrefKind,
  ) =>
    grouped.map((g) => {
      const r = g.sample as IPref;
      const matchingIds = (rows ?? []).filter(
        (x) =>
          x.availability_type === r.availability_type &&
          x.start_time.slice(0, 5) === r.start_time.slice(0, 5) &&
          x.end_time.slice(0, 5) === r.end_time.slice(0, 5) &&
          (x.notes ?? "") === (r.notes ?? ""),
      );
      return (
        <li
          key={`${kind}-${r.start_time}-${r.end_time}-${g.days.join(",")}`}
          className="flex items-center justify-between p-3"
        >
          <div>
            <p className="text-sm font-medium">
              {g.label}{" "}
              <span dir="ltr">
                {r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {KIND_LABELS[kind]} · تفضيل ناعم (Soft)
              {g.label === "كل أيام الدوام" ? " · سجلات يومية مستقلة" : ""}
              {r.notes ? ` · ${r.notes}` : ""}
            </p>
          </div>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="soft-pref-delete"
              onClick={() => {
                void (async () => {
                  for (const row of matchingIds) {
                    await del.mutateAsync(row.id);
                  }
                })();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </li>
      );
    });

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Label>المحاضر</Label>
        <Select value={instructorId} onValueChange={setInstructorId}>
          <SelectTrigger data-testid="soft-pref-instructor-select">
            <SelectValue placeholder="اختر محاضراً" />
          </SelectTrigger>
          <SelectContent>
            {(instructors ?? []).map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {instructorId && canManage && (
        <Card className="p-4" data-testid="soft-pref-form">
          <p className="mb-3 text-sm font-semibold">إضافة تفضيل زمني (ناعم)</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="col-span-2 md:col-span-1">
              <Label>نوع التفضيل</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => setForm({ ...form, kind: v as PrefKind })}
              >
                <SelectTrigger data-testid="soft-pref-kind-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">فترة مفضّلة</SelectItem>
                  <SelectItem value="unavailable">فترة غير مفضّلة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>اليوم</Label>
              <Select
                value={form.dayValue}
                onValueChange={(v) => setForm({ ...form, dayValue: v })}
              >
                <SelectTrigger data-testid="soft-pref-day-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACTIVE_DAYS_SENTINEL}>كل أيام الدوام</SelectItem>
                  {activeDays.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {DAYS[day] ?? `اليوم ${day}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>من</Label>
              <Input
                dir="ltr"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label>إلى</Label>
              <Input
                dir="ltr"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => add.mutate()}
                disabled={add.isPending}
                className="w-full"
                data-testid="soft-pref-add"
              >
                إضافة
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="soft-pref-affected-days">
            سيتم تطبيق التفضيل على{" "}
            {form.dayValue === ALL_ACTIVE_DAYS_SENTINEL ? activeDays.length : 1}{" "}
            {form.dayValue === ALL_ACTIVE_DAYS_SENTINEL && activeDays.length !== 1
              ? "أيام"
              : "يوم"}{" "}
            من أيام وفترات الدوام.
          </p>
        </Card>
      )}

      <Card className="overflow-hidden" data-testid="soft-prefs-list">
        {!instructorId ? (
          <p className="p-6 text-center text-muted-foreground">
            اختر محاضراً لعرض تفضيلاته الزمنية.
          </p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">
            لا توجد تفضيلات ناعمة لهذا المحاضر. غياب التفضيل لا يقيّد الجدولة إطلاقًا.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {renderGroup(groupedPreferred, "available")}
            {renderGroup(groupedAvoided, "unavailable")}
          </ul>
        )}
      </Card>

      {instructorId && !canManage && (
        <p className="text-xs text-muted-foreground" data-testid="soft-prefs-readonly-note">
          وضع قراءة فقط — عرض التفضيلات دون تعديل.
        </p>
      )}
    </div>
  );
}
