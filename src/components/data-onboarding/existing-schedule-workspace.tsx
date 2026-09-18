import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type Source = Tables<"existing_schedule_source_rows">;
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const IT = "7168345f-cf9d-4789-b2ad-547abb687dc8";

export function ExistingScheduleWorkspace({
  collegeId,
  canManage,
  onModeChange,
}: {
  collegeId: string;
  canManage: boolean;
  onModeChange: (active: boolean) => void;
}) {
  const cache = useQueryClient();
  const [termChoice, setTermChoice] = useState("");
  const [search, setSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [room, setRoom] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const terms = useQuery({
    queryKey: ["existing-terms", collegeId],
    enabled: collegeId !== IT,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id,name")
        .eq("college_id", collegeId)
        .eq("academic_year", "2026-2027")
        .eq("term_type", "first");
      if (error) throw error;
      return data ?? [];
    },
  });
  const termId = termChoice || terms.data?.[0]?.id;
  const mode = useQuery({
    queryKey: ["existing-mode", collegeId, termId],
    enabled: !!termId && collegeId !== IT,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("existing_schedule_intake")
        .select("enabled")
        .eq("college_id", collegeId)
        .eq("term_id", termId!)
        .maybeSingle();
      if (error) throw error;
      return !!data?.enabled;
    },
  });
  const enabled = collegeId !== IT && !!mode.data;
  useEffect(() => onModeChange(enabled), [enabled, onModeChange]);
  const bundle = useQuery({
    queryKey: ["existing-source", collegeId, termId],
    enabled,
    queryFn: async () => {
      const responses = await Promise.all([
        supabase
          .from("existing_schedule_source_rows")
          .select("*")
          .eq("college_id", collegeId)
          .eq("term_id", termId!)
          .order("source_id"),
        supabase
          .from("rooms")
          .select("id,name,code")
          .eq("college_id", collegeId)
          .eq("is_active", true),
        supabase.from("instructors").select("id,full_name").eq("college_id", collegeId),
        supabase.from("study_plans").select("id,name").eq("college_id", collegeId),
      ]);
      for (const r of responses) if (r.error) throw r.error;
      return {
        rows: responses[0].data ?? [],
        rooms: responses[1].data ?? [],
        instructors: responses[2].data ?? [],
        plans: responses[3].data ?? [],
      };
    },
  });
  if (collegeId === IT || !termId) return null;
  const error = terms.error || mode.error || bundle.error;
  if (error)
    return (
      <Card className="p-5" role="alert">
        تعذر تحميل الجداول القائمة: {error.message}
        <Button
          onClick={() => {
            void mode.refetch();
            void bundle.refetch();
          }}
        >
          إعادة المحاولة
        </Button>
      </Card>
    );
  if (!enabled)
    return (
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">نقل الجداول المعمول بها</h2>
        <p className="text-sm text-muted-foreground">
          للفصل الأول 2026–2027: حفظ الجداول الحالية كما هي، مع استكمال الأعداد والقاعات والنواقص
          لاحقًا.
        </p>
        {canManage && (
          <Button
            onClick={async () => {
              const { error } = await supabase
                .from("existing_schedule_intake")
                .upsert(
                  { college_id: collegeId, term_id: termId, enabled: true },
                  { onConflict: "college_id,term_id" },
                );
              if (error) toast.error(error.message);
              else await mode.refetch();
            }}
          >
            استخدام الجداول القائمة
          </Button>
        )}
      </Card>
    );
  const rows = bundle.data?.rows ?? [];
  const names = new Map((bundle.data?.instructors ?? []).map((i) => [i.id, i.full_name]));
  const plans = new Map((bundle.data?.plans ?? []).map((p) => [p.id, p.name]));
  const sessions = new Set(rows.map((r) => r.schedule_session_id).filter(Boolean)).size;
  const pending = rows.filter((r) => !r.schedule_session_id).length;
  const missingRooms = rows.filter((r) => !r.room_id).length;
  const visible = rows.filter(
    (r) =>
      (!pendingOnly || !r.schedule_session_id || r.pending_reasons.length > 0) &&
      `${r.raw_course} ${r.raw_teacher} ${r.instructor_ids.map((id) => names.get(id) ?? "").join(" ")} ${plans.get(r.study_plan_id ?? "")}`.includes(
        search,
      ),
  );
  const versionId = rows.find((r) => r.schedule_version_id)?.schedule_version_id;
  function edit(r: Source) {
    setEditing(r);
    setStart(r.start_time?.slice(0, 5) ?? "");
    setEnd(r.end_time?.slice(0, 5) ?? "");
    setRoom(r.room_id ?? "");
    setAllocations({});
  }
  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const split = Object.fromEntries(
        Object.entries(allocations)
          .filter(([, value]) => value !== "")
          .map(([id, value]) => [id, Number(value)]),
      );
      // الدالة في قاعدة البيانات تقبل NULL، لكن الأنواع المولّدة تلقائيًا تعتبر
      // المعاملات نصوصًا إلزامية، لذا التحويل على حدود الاستدعاء فقط.
      const args = {
        p_source: editing.id,
        p_day: editing.day_of_week ?? 6,
        p_start: start || null,
        p_end: end || null,
        p_room: room || null,
        p_allocations: Object.keys(split).length ? split : null,
      } as unknown as Database["public"]["Functions"]["complete_existing_schedule_source"]["Args"];
      const { error } = await supabase.rpc("complete_existing_schedule_source", args);
      if (error) throw error;
      await cache.invalidateQueries();
      setEditing(null);
      toast.success("حُفظ الاستكمال في الجدول والتقارير");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="الجداول القائمة">
      <Card className="space-y-3 p-5">
        <h2 className="text-xl font-semibold">الجداول القائمة — الفصل الأول 2026–2027</h2>
        <p className="text-sm text-muted-foreground">
          تُحفظ مواعيد الكلية وتقسيماتها كما هي. الأعداد والسعات وسنة دخول الدفعة غير المحددة تبقى
          بانتظار الاستكمال، دون توليد أو تقسيم تلقائي.
        </p>
        {(terms.data?.length ?? 0) > 1 && (
          <select
            aria-label="الفصل الأكاديمي"
            value={termId}
            onChange={(e) => setTermChoice(e.target.value)}
          >
            {terms.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["سجلات المصدر", rows.length],
            ["الجلسات الفعلية", sessions],
            ["بانتظار موعد", pending],
            ["بانتظار قاعة", missingRooms],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-sm">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-sm">
          المحاضرات المشتركة: {rows.filter((r) => r.shared_member).length} ارتباطات إضافية بجلسات
          محفوظة مرة واحدة. النواقص لا تُحذف من الجدول.
        </p>
        <div className="flex flex-wrap gap-3">
          {versionId && (
            <Button asChild>
              <Link to="/timetable/$versionId" params={{ versionId }}>
                عرض الجدول الحالي
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href={`/reports/current-timetable?termId=${termId}&versionId=${versionId ?? ""}`}>
              الجدول العام والطباعة
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/reports/instructor-schedule?termId=${termId}&versionId=${versionId ?? ""}`}>
              الجداول الفردية
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a
              href={`/reports/program-level-timetable?termId=${termId}&versionId=${versionId ?? ""}`}
            >
              جداول الأقسام والبرامج
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/reports/academic-affairs">الإسناد والساعات الزائدة</Link>
          </Button>
          <Button variant="outline" onClick={() => void bundle.refetch()}>
            تحديث
          </Button>
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Input
            aria-label="بحث في الجداول القائمة"
            placeholder="بحث بالمقرر أو المحاضر أو البرنامج"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
            />
            النواقص فقط
          </label>
        </div>
        {bundle.isLoading ? (
          <p role="status">جارٍ تحميل الجداول…</p>
        ) : (
          <div className="max-h-[650px] overflow-auto">
            <table className="w-full text-right text-sm">
              <thead className="sticky top-0 bg-background">
                <tr>
                  {[
                    "البرنامج / المستوى",
                    "المقرر",
                    "المحاضر",
                    "الموعد",
                    "القاعة",
                    "المراجعة",
                    "",
                  ].map((h, i) => (
                    <th className="border-b p-3" key={i}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="p-3">
                      {plans.get(r.study_plan_id ?? "")}
                      <br />
                      المستوى {r.level_number}
                    </td>
                    <td className="p-3">
                      {r.raw_course}
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary>المصدر</summary>
                        {r.source_file}
                        <br />
                        {r.source_cell}
                      </details>
                    </td>
                    <td className="p-3">
                      {r.instructor_ids.map((id) => names.get(id) ?? r.raw_teacher).join(" + ") ||
                        r.raw_teacher}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {DAYS[r.day_of_week ?? 6]}
                      <br />
                      {r.start_time && r.end_time
                        ? `${r.start_time.slice(0, 5)} – ${r.end_time.slice(0, 5)}`
                        : "بانتظار تحديد الوقت"}
                    </td>
                    <td className="p-3">
                      {bundle.data?.rooms.find((room) => room.id === r.room_id)?.name ??
                        (r.raw_room === "احتياج"
                          ? "بانتظار تحديد القاعة"
                          : r.raw_room || "غير محددة")}
                    </td>
                    <td className="p-3">
                      {r.shared_member && <p>محاضرة مشتركة</p>}
                      {r.pending_reasons.length ? (
                        r.pending_reasons.map((reason) => (
                          <p key={reason} className="text-amber-700">
                            {reason}
                          </p>
                        ))
                      ) : (
                        <span className="text-emerald-700">محفوظة</span>
                      )}
                    </td>
                    <td className="p-3">
                      {canManage && (r.pending_reasons.length > 0 || !r.schedule_session_id) && (
                        <Button size="sm" variant="outline" onClick={() => edit(r)}>
                          استكمال
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="p-5">
                لم تُدخل جداول لهذا الفصل بعد. يمكن نقل ملفات الكلية مع إبقاء البيانات الناقصة
                للاستكمال.
              </p>
            )}
          </div>
        )}
      </Card>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>استكمال {editing?.raw_course}</DialogTitle>
          </DialogHeader>
          <p>{DAYS[editing?.day_of_week ?? 6]} — تُحفظ المواعيد الحالية كما هي.</p>
          <div className="grid grid-cols-2 gap-3">
            <label>
              البداية
              <Input
                type="time"
                value={start}
                disabled={!!editing?.schedule_session_id}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              النهاية
              <Input
                type="time"
                value={end}
                disabled={!!editing?.schedule_session_id}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <label className="space-y-1">
            القاعة
            <select
              aria-label="القاعة"
              className="w-full rounded-md border bg-background p-2"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            >
              <option value="">بانتظار التحديد</option>
              {bundle.data?.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.code}
                </option>
              ))}
            </select>
          </label>
          {(editing?.instructor_ids.length ?? 0) > 1 && (
            <fieldset className="space-y-2">
              <legend>توزيع ساعات التدريس المشترك</legend>
              <p className="text-sm text-muted-foreground">
                أدخل الساعات المعتمدة لكل محاضر، أو اتركها للاستكمال لاحقًا.
              </p>
              {editing?.instructor_ids.map((id) => (
                <label className="block" key={id}>
                  {names.get(id)}
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={allocations[id] ?? ""}
                    onChange={(e) => setAllocations({ ...allocations, [id]: e.target.value })}
                  />
                </label>
              ))}
            </fieldset>
          )}
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "جارٍ الحفظ…" : "حفظ الاستكمال"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
