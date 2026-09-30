import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * AI-assisted placement suggestions for unresolved source timetable rows.
 * READ-ONLY: never writes sessions. The model may only rank candidates the
 * server already proved conflict-free; every pick is re-validated afterwards.
 */

type Db = {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => any;
};

const DAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

async function assertSuperAdmin(db: Db, userId: string) {
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  if (error) throw new Error("تعذر التحقق من الصلاحية.");
  if (!data?.length) throw new Error("هذه الميزة لمسؤولي النظام فقط.");
}

async function pageAll(q: () => any, size = 1000) {
  const out: any[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await q().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < size) return out;
  }
}

export const listUnresolvedRows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as Db;
    await assertSuperAdmin(db, context.userId);
    const rows = await pageAll(() =>
      db
        .from("existing_schedule_source_rows")
        .select(
          "id, college_id, term_id, schedule_version_id, raw_course, raw_teacher, raw_day, raw_time, raw_room, day_of_week, start_time, end_time, room_id, status, pending_reasons, schedule_session_id",
        )
        .neq("status", "imported")
        .is("schedule_session_id", null)
        .order("college_id")
        .order("id"),
    );
    const collegeIds = [...new Set(rows.map((r) => r.college_id))];
    const { data: colleges } = collegeIds.length
      ? await db.from("colleges").select("id, name").in("id", collegeIds)
      : { data: [] };
    const names = new Map((colleges ?? []).map((c: any) => [c.id, c.name]));
    return rows.map((r) => ({ ...r, college_name: names.get(r.college_id) ?? "" }));
  });

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Busy = { day: number; s: number; e: number; id: string; label: string };
const clash = (list: Busy[] | undefined, day: number, s: number, e: number) =>
  (list ?? []).filter((b) => b.day === day && b.s < e && s < b.e);

export type Suggestion = {
  room_id: string;
  room_label: string;
  room_capacity: number;
  room_type: string;
  day_of_week: number;
  day_label: string;
  start_time: string;
  end_time: string;
  reason: string;
  checks: { room: string[]; instructor: string[]; group: string[] };
  valid: boolean;
};

async function askModel(prompt: string): Promise<{ picks: { key: string; reason: string }[] }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("مفتاح خدمة الذكاء الاصطناعي غير مهيأ.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      input: [
        {
          role: "system",
          content:
            "أنت مساعد جدولة جامعية. اختر حتى 5 بدائل فقط من المرشحين المعطين (لا تخترع مفاتيح). فضّل الأقرب للموعد والقاعة الأصلية، ثم السعة الأقرب لعدد الطلاب دون هدر، ثم نفس اليوم. اكتب سببًا عربيًا قصيرًا لكل اختيار.",
        },
        { role: "user", content: prompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "picks",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["picks"],
            properties: {
              picks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["key", "reason"],
                  properties: { key: { type: "string" }, reason: { type: "string" } },
                },
              },
            },
          },
        },
      },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    if (res.status === 402) throw new Error("نفد رصيد الذكاء الاصطناعي في مساحة العمل.");
    if (res.status === 429) throw new Error("تم تجاوز حد الطلبات مؤقتًا؛ حاول بعد قليل.");
    console.error("AI gateway", res.status, body.slice(0, 500));
    throw new Error(`تعذر الحصول على اقتراحات (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
        if (ev.type === "error" || ev.type === "response.failed")
          throw new Error("فشل النموذج في إنتاج الاقتراحات.");
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("فشل")) throw e;
      }
    }
  }
  if (!text.trim()) throw new Error("لم يُرجع النموذج أي اقتراح.");
  return JSON.parse(text);
}

export const suggestForRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rowId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    await assertSuperAdmin(db, context.userId);

    const { data: row, error } = await db
      .from("existing_schedule_source_rows")
      .select("*")
      .eq("id", data.rowId)
      .maybeSingle();
    if (error || !row) throw new Error("الصف غير موجود أو غير متاح.");

    const [groupRes, compRes, settingsRes] = await Promise.all([
      row.delivery_group_id
        ? db
            .from("delivery_groups")
            .select("id, expected_students, cohort_id")
            .eq("id", row.delivery_group_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      row.component_id
        ? db
            .from("plan_course_components")
            .select("component_type, weekly_contact_hours")
            .eq("id", row.component_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from("scheduling_settings")
        .select("working_days, day_start_time, day_end_time")
        .eq("college_id", row.college_id)
        .maybeSingle(),
    ]);
    const group = groupRes.data;
    const comp = compRes.data;
    const settings = settingsRes.data;
    const students = Number(group?.expected_students ?? 0);
    const practical = /practical|lab/i.test(String(comp?.component_type ?? ""))
      || /معمل|عملي/.test(String(row.raw_course ?? ""));
    const durationMin =
      row.start_time && row.end_time
        ? toMin(row.end_time) - toMin(row.start_time)
        : Math.round(Number(comp?.weekly_contact_hours ?? 2) * 60);
    const workingDays: number[] = settings?.working_days ?? [6, 0, 1, 2, 3];
    const dayStart = toMin(settings?.day_start_time ?? "08:00");
    // Theory ends by 14:00; practical may use the full college day.
    const dayEnd = Math.min(
      toMin(settings?.day_end_time ?? "16:00"),
      practical ? 24 * 60 : 14 * 60,
    );

    // All non-archived versions of this term, across every college (shared rooms/teachers).
    const { data: versions } = await db
      .from("schedule_versions")
      .select("id, college_id, status")
      .eq("academic_term_id", row.term_id)
      .neq("status", "archived");
    const versionIds = (versions ?? [])
      .filter((v: any) => v.status !== "draft" || v.id === row.schedule_version_id)
      .map((v: any) => v.id);
    const sessions = versionIds.length
      ? await pageAll(() =>
          db
            .from("schedule_sessions")
            .select(
              "id, schedule_version_id, room_id, instructor_id, delivery_group_id, cohort_id, day_of_week, start_time, end_time, replaced_by_split",
            )
            .in("schedule_version_id", versionIds)
            .eq("replaced_by_split", false)
            .order("id"),
        )
      : [];

    const byRoom = new Map<string, Busy[]>();
    const byTeacher = new Map<string, Busy[]>();
    const byGroup = new Map<string, Busy[]>();
    const push = (m: Map<string, Busy[]>, k: string | null, b: Busy) => {
      if (!k) return;
      (m.get(k) ?? m.set(k, []).get(k)!).push(b);
    };
    for (const s of sessions) {
      const b = {
        day: s.day_of_week,
        s: toMin(s.start_time),
        e: toMin(s.end_time),
        id: s.id,
        label: `${DAY_AR[s.day_of_week]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
      };
      push(byRoom, s.room_id, b);
      push(byTeacher, s.instructor_id, b);
      push(byGroup, s.delivery_group_id, b);
      if (row.cohort_id && s.cohort_id === row.cohort_id && !s.delivery_group_id)
        push(byGroup, row.delivery_group_id, b);
    }
    const teachers: string[] = row.instructor_ids ?? [];

    const { data: rooms } = await db
      .from("rooms")
      .select("id, code, name, capacity, room_type, is_active, college_id")
      .eq("college_id", row.college_id)
      .eq("is_active", true);
    const eligible = (rooms ?? []).filter((r: any) => {
      const lab = /lab|workshop/i.test(r.room_type);
      return (practical ? lab : !lab) && r.capacity >= Math.max(students, 1);
    });

    const check = (roomId: string, day: number, s: number, e: number) => ({
      room: clash(byRoom.get(roomId), day, s, e).map((b) => b.label),
      instructor: teachers.flatMap((t) => clash(byTeacher.get(t), day, s, e).map((b) => b.label)),
      group: clash(byGroup.get(row.delivery_group_id ?? ""), day, s, e).map((b) => b.label),
    });

    type Cand = { key: string; room: any; day: number; s: number; e: number; score: number };
    const cands: Cand[] = [];
    for (const room of eligible)
      for (const day of workingDays)
        for (let s = dayStart; s + durationMin <= dayEnd; s += 60) {
          const e = s + durationMin;
          const c = check(room.id, day, s, e);
          if (c.room.length || c.instructor.length || c.group.length) continue;
          const sameDay = row.day_of_week === day ? 0 : 1;
          const timeDist = row.start_time ? Math.abs(toMin(row.start_time) - s) / 60 : 0;
          const sameRoom = row.room_id === room.id ? 0 : 1;
          const waste = (room.capacity - students) / 10;
          cands.push({
            key: `${room.id}|${day}|${toTime(s)}`,
            room, day, s, e,
            score: sameDay * 6 + timeDist * 2 + sameRoom * 3 + waste,
          });
        }
    cands.sort((a, b) => a.score - b.score);
    const shortlist = cands.slice(0, 40);

    const context_ = {
      course: row.raw_course,
      teacher: row.raw_teacher,
      original: {
        day: row.day_of_week != null ? DAY_AR[row.day_of_week] : row.raw_day,
        time: row.start_time ? `${row.start_time.slice(0, 5)}–${row.end_time?.slice(0, 5)}` : row.raw_time,
        room: row.raw_room,
      },
      students,
      practical,
      duration_minutes: durationMin,
      pending_reasons: row.pending_reasons,
    };

    let picks: { key: string; reason: string }[] = [];
    let aiError: string | null = null;
    if (shortlist.length) {
      try {
        const res = await askModel(
          JSON.stringify({
            row: context_,
            candidates: shortlist.map((c) => ({
              key: c.key,
              room: c.room.name || c.room.code,
              capacity: c.room.capacity,
              room_type: c.room.room_type,
              day: DAY_AR[c.day],
              time: `${toTime(c.s)}–${toTime(c.e)}`,
            })),
          }),
        );
        picks = res.picks ?? [];
      } catch (e) {
        aiError = e instanceof Error ? e.message : "تعذر الاتصال بالنموذج.";
      }
    }
    const known = new Map(shortlist.map((c) => [c.key, c]));
    let chosen = picks.filter((p) => known.has(p.key)).slice(0, 5);
    if (!chosen.length)
      chosen = shortlist.slice(0, 5).map((c) => ({ key: c.key, reason: "ترتيب آلي حسب القرب من الموعد الأصلي والسعة." }));

    // Independent re-validation of every final suggestion.
    const suggestions: Suggestion[] = chosen.map((p) => {
      const c = known.get(p.key)!;
      const checks = check(c.room.id, c.day, c.s, c.e);
      return {
        room_id: c.room.id,
        room_label: c.room.name || c.room.code,
        room_capacity: c.room.capacity,
        room_type: c.room.room_type,
        day_of_week: c.day,
        day_label: DAY_AR[c.day],
        start_time: toTime(c.s),
        end_time: toTime(c.e),
        reason: p.reason,
        checks,
        valid: !checks.room.length && !checks.instructor.length && !checks.group.length,
      };
    });

    return {
      row: context_,
      stats: {
        eligible_rooms: eligible.length,
        conflict_free_candidates: cands.length,
        sessions_checked: sessions.length,
        teachers_known: teachers.length,
        group_known: !!row.delivery_group_id,
      },
      ai_used: !aiError && picks.length > 0,
      ai_error: aiError,
      suggestions,
    };
  });
