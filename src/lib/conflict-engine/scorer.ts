import { supabase } from "@/integrations/supabase/client";
import { validateProposed, type Conflict, type ProposedSession } from "./validator";

export interface SoftViolation {
  code: string;
  severity: "soft";
  message_ar: string;
  message_en: string;
  score_impact: number;
  metadata?: Record<string, unknown>;
}

export interface QualityResult {
  total_score: number;
  hard_conflicts_count: number;
  soft_conflicts_count: number;
  total_deductions: number;
  hard_conflicts: Conflict[];
  soft_violations: SoftViolation[];
  metrics_breakdown: Record<string, { weight: number; deduction: number; count: number }>;
}

const t = (s: string) => (s.length === 5 ? `${s}:00` : s);
const mins = (s: string) => {
  const [h, m] = t(s).split(":").map(Number);
  return h * 60 + m;
};
const overlap = (aS: string, aE: string, bS: string, bE: string) =>
  t(aS) < t(bE) && t(bS) < t(aE);

/**
 * Score a set of proposed sessions for a schedule version.
 * Pure read-only: does not persist.
 */
export async function scoreSchedule(params: {
  collegeId: string;
  scheduleVersionId: string;
  sessions: ProposedSession[];
}): Promise<QualityResult> {
  const { collegeId, scheduleVersionId, sessions } = params;

  // 1. Hard conflicts (re-use validator)
  const hard = await validateProposed({ collegeId, scheduleVersionId, sessions });

  // 2. Weights (college overrides → default)
  const { data: metrics } = await supabase.from("quality_metrics").select("*").eq("is_active", true);
  const { data: settings } = await supabase
    .from("college_quality_settings")
    .select("quality_metric_id, enabled, weight")
    .eq("college_id", collegeId);
  const sMap = new Map((settings ?? []).map((s) => [s.quality_metric_id, s]));
  const weightOf = (code: string) => {
    const m = (metrics ?? []).find((x) => x.code === code);
    if (!m) return { enabled: false, weight: 0 };
    const s = sMap.get(m.id);
    return { enabled: s ? s.enabled : true, weight: s ? s.weight : m.default_weight };
  };

  const soft: SoftViolation[] = [];
  const breakdown: QualityResult["metrics_breakdown"] = {};
  const note = (code: string, weight: number, dedu: number) => {
    breakdown[code] = breakdown[code] ?? { weight, deduction: 0, count: 0 };
    breakdown[code].deduction += dedu;
    breakdown[code].count += 1;
  };

  // Pre-fetch instructor preferences once
  const instructorIds = Array.from(new Set(sessions.map((s) => s.instructor_id)));
  const { data: prefs } = instructorIds.length
    ? await supabase
        .from("instructor_availability")
        .select("instructor_id, day_of_week, start_time, end_time, availability_type, is_preference")
        .in("instructor_id", instructorIds)
        .eq("is_preference", true)
    : { data: [] };

  // A. preferred_days
  const pdW = weightOf("preferred_days");
  if (pdW.enabled) {
    for (const s of sessions) {
      const sPrefs = (prefs ?? []).filter(
        (p) => p.instructor_id === s.instructor_id && p.day_of_week === s.day_of_week,
      );
      if (sPrefs.length === 0) continue;
      const wanted = sPrefs.filter((p) => p.availability_type !== "unavailable");
      const blocked = sPrefs.filter((p) => p.availability_type === "unavailable");
      const fits = wanted.length === 0 ||
        wanted.some((w) => t(s.start_time) >= t(w.start_time) && t(s.end_time) <= t(w.end_time));
      const hitsBlocked = blocked.some((w) => overlap(s.start_time, s.end_time, w.start_time, w.end_time));
      if (!fits || hitsBlocked) {
        const dedu = pdW.weight;
        soft.push({
          code: "preferred_days", severity: "soft", score_impact: dedu,
          message_ar: "الجلسة خارج تفضيلات المحاضر المرنة.",
          message_en: "Session outside instructor's preferred times.",
          metadata: { instructor_id: s.instructor_id, day_of_week: s.day_of_week },
        });
        note("preferred_days", pdW.weight, dedu);
      }
    }
  }

  // B. workload_balance
  const wbW = weightOf("workload_balance");
  if (wbW.enabled && instructorIds.length > 1) {
    const load = new Map<string, number>();
    for (const s of sessions) {
      const dur = mins(s.end_time) - mins(s.start_time);
      load.set(s.instructor_id, (load.get(s.instructor_id) ?? 0) + dur);
    }
    const values = Array.from(load.values());
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    for (const [iid, mn] of load.entries()) {
      const diff = Math.abs(mn - avg);
      if (avg > 0 && diff / avg > 0.25) {
        const dedu = wbW.weight;
        soft.push({
          code: "workload_balance", severity: "soft", score_impact: dedu,
          message_ar: "حِمل المحاضر بعيد عن المتوسط.",
          message_en: "Instructor load deviates from average.",
          metadata: { instructor_id: iid, minutes: mn, average: Math.round(avg) },
        });
        note("workload_balance", wbW.weight, dedu);
      }
    }
  }

  // C. gap_penalty
  const gpW = weightOf("gap_penalty");
  if (gpW.enabled) {
    const byInstrDay = new Map<string, ProposedSession[]>();
    for (const s of sessions) {
      const k = `${s.instructor_id}|${s.day_of_week}`;
      const arr = byInstrDay.get(k) ?? [];
      arr.push(s); byInstrDay.set(k, arr);
    }
    for (const [k, arr] of byInstrDay.entries()) {
      if (arr.length < 2) continue;
      const sorted = [...arr].sort((a, b) => mins(a.start_time) - mins(b.start_time));
      for (let i = 1; i < sorted.length; i++) {
        const gap = mins(sorted[i].start_time) - mins(sorted[i - 1].end_time);
        if (gap > 60) {
          const dedu = gpW.weight;
          soft.push({
            code: "gap_penalty", severity: "soft", score_impact: dedu,
            message_ar: `فجوة كبيرة بين جلستَي محاضر (${gap} دقيقة).`,
            message_en: `Large gap between instructor sessions (${gap} minutes).`,
            metadata: { key: k, gap_minutes: gap },
          });
          note("gap_penalty", gpW.weight, dedu);
        }
      }
    }
  }

  // D. distribution_balance — concentration on few days
  const dbW = weightOf("distribution_balance");
  if (dbW.enabled && sessions.length >= 5) {
    const perDay = new Map<number, number>();
    for (const s of sessions) perDay.set(s.day_of_week, (perDay.get(s.day_of_week) ?? 0) + 1);
    const usedDays = perDay.size;
    if (usedDays <= 2) {
      const dedu = dbW.weight * 2;
      soft.push({
        code: "distribution_balance", severity: "soft", score_impact: dedu,
        message_ar: "التوزيع الأسبوعي ضعيف — تركّز الجلسات على أيام قليلة.",
        message_en: "Weak weekly distribution — sessions concentrated on few days.",
        metadata: { used_days: usedDays },
      });
      note("distribution_balance", dbW.weight, dedu);
    } else {
      const values = Array.from(perDay.values());
      const max = Math.max(...values), min = Math.min(...values);
      if (max - min >= 3) {
        const dedu = dbW.weight;
        soft.push({
          code: "distribution_balance", severity: "soft", score_impact: dedu,
          message_ar: "تفاوت كبير في توزيع الجلسات بين الأيام.",
          message_en: "Large variance in per-day session counts.",
          metadata: { max, min },
        });
        note("distribution_balance", dbW.weight, dedu);
      }
    }
  }

  const total_deductions = soft.reduce((a, v) => a + v.score_impact, 0);
  const total_score = Math.max(0, 100 - total_deductions);

  return {
    total_score,
    hard_conflicts_count: hard.length,
    soft_conflicts_count: soft.length,
    total_deductions,
    hard_conflicts: hard,
    soft_violations: soft,
    metrics_breakdown: breakdown,
  };
}

/** Score a stored schedule version and persist a run row. */
export async function scoreScheduleVersion(params: {
  collegeId: string;
  scheduleVersionId: string;
  persist?: boolean;
}): Promise<{ runId: string | null; result: QualityResult }> {
  const { collegeId, scheduleVersionId } = params;
  const persist = params.persist ?? true;

  const { data: sessions, error } = await supabase
    .from("schedule_sessions")
    .select("*")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId);
  if (error) throw error;

  const proposed: ProposedSession[] = (sessions ?? []).map((s) => ({
    id: s.id, schedule_version_id: s.schedule_version_id,
    course_offering_id: s.course_offering_id,
    teaching_assignment_id: s.teaching_assignment_id,
    instructor_id: s.instructor_id, room_id: s.room_id,
    section_id: s.section_id, section_group_id: s.section_group_id,
    study_system: s.study_system as ProposedSession["study_system"],
    day_of_week: s.day_of_week,
    start_time: s.start_time, end_time: s.end_time,
    session_type: s.session_type, expected_students: s.expected_students,
  }));

  const result = await scoreSchedule({ collegeId, scheduleVersionId, sessions: proposed });

  if (!persist) return { runId: null, result };

  const { data: userData } = await supabase.auth.getUser();
  const { data: row, error: ie } = await supabase
    .from("schedule_quality_runs")
    .insert({
      college_id: collegeId,
      schedule_version_id: scheduleVersionId,
      total_score: result.total_score,
      hard_conflicts_count: result.hard_conflicts_count,
      soft_conflicts_count: result.soft_conflicts_count,
      total_deductions: result.total_deductions,
      metrics_breakdown: result.metrics_breakdown as never,
      run_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (ie) throw ie;
  return { runId: row.id, result };
}
