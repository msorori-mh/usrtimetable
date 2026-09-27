import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";
import {
  ITCS_DRAFT_ID,
  ITCS_PUBLISHED_ID,
  MANIFEST_FILE,
  buildUnitResolver,
  diffAgainstLive,
  targetPathRules,
  validateManifest,
  type CutoverManifest,
  type LiveSession,
} from "@/lib/itcs-cutover/manifest";

export const Route = createFileRoute("/_authenticated/itcs-cutover")({
  head: () => ({
    meta: [
      { title: "انتقال جدول كلية الحاسوب — مراجعة البيان" },
      { name: "description", content: "رفع بيان استعادة جدول ITCS ومعاينة الفروق والتحقق قبل النشر." },
      { property: "og:title", content: "انتقال جدول كلية الحاسوب" },
      { property: "og:description", content: "معاينة ومطابقة بيان استعادة جدول ITCS قبل النشر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ItcsCutoverPage,
});

// Functions from the proposed migration 20260927c (Rev5); absent until it is applied.
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
type Stage = "requests" | "apply" | "publish";
type Repl = { replaces: string; cross_college: boolean; state: string; scoped_request: string | null };

function ItcsCutoverPage() {
  const { data: me, isLoading } = useCurrentUser();
  const [manifest, setManifest] = useState<CutoverManifest | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [diff, setDiff] = useState<ReturnType<typeof diffAgainstLive> | null>(null);
  const [rules, setRules] = useState<ReturnType<typeof targetPathRules> | null>(null);
  const [server, setServer] = useState<Record<string, unknown> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <p className="p-6">جارٍ التحميل…</p>;
  if (!me?.isSuperAdmin) return <p className="p-6 text-destructive">هذه الصفحة متاحة لمدير النظام فقط.</p>;

  const add = (s: string) => setLog((l) => [...l, `${new Date().toISOString()} ${s}`]);

  async function onFile(file: File) {
    setManifest(null); setDiff(null); setRules(null); setServer(null);
    let raw: unknown;
    try { raw = JSON.parse(await file.text()); } catch { setErrors(["INVALID_JSON"]); return; }
    const v = validateManifest(raw);
    setErrors(v.errors);
    if (!v.manifest) { add(`رُفض البيان: ${v.errors.length} خطأ`); return; }
    const { data, error } = await supabase
      .from("schedule_sessions")
      .select("id, day_of_week, start_time, end_time, room_id, instructor_id, teaching_assignment_id, delivery_group_id, cohort_id")
      .eq("schedule_version_id", ITCS_DRAFT_ID);
    if (error) { setErrors([error.message]); return; }
    const live = (data ?? []) as (LiveSession & { delivery_group_id: string | null; cohort_id: string | null })[];
    const groupIds = [...new Set(live.map((s) => s.delivery_group_id).filter(Boolean))] as string[];
    const [links, members] = await Promise.all([
      supabase.from("shared_lecture_links").select("member_group_id, anchor_group_id"),
      supabase.from("delivery_group_partition_members").select("delivery_group_id, partition_id, cohort_student_partitions!inner(active)")
        .eq("cohort_student_partitions.active", true),
    ]);
    if (links.error || members.error) { setErrors([(links.error ?? members.error)!.message]); return; }
    const partitions = new Map<string, string[]>();
    for (const r of members.data ?? []) partitions.set(r.delivery_group_id, [...(partitions.get(r.delivery_group_id) ?? []), r.partition_id]);
    const unitsOf = buildUnitResolver(new Map(live.map((s) => [s.id, s])), partitions, links.data ?? []);
    setManifest(v.manifest);
    setDiff(diffAgainstLive(v.manifest, live));
    setRules(targetPathRules(v.manifest, unitsOf));
    add(`قُرئ البيان: ${v.manifest.sessions.length} جلسة، ${groupIds.length} مجموعة`);
  }

  async function serverPreview() {
    if (!manifest) return;
    setBusy(true);
    const { data, error } = await rpc("itcs_cutover_preview", { p_version: ITCS_DRAFT_ID, p_manifest: manifest });
    setBusy(false);
    if (error) { add(`HOLD — المعاينة من الخادم: ${error.message}`); return; }
    setServer(data as Record<string, unknown>); add("نجحت معاينة الخادم");
  }

  async function runStage(stage: Stage) {
    if (!manifest || !server) return;
    setBusy(true);
    try {
      const snap = await rpc("itcs_cutover_published_snapshot", { p_published: ITCS_PUBLISHED_ID });
      if (snap.error) throw new Error(snap.error.message);
      if (stage === "publish") {
        // Official quality pipeline: snapshot revision -> score -> persist_schedule_quality_run.
        const ver = await supabase.from("schedule_versions").select("college_id").eq("id", ITCS_DRAFT_ID).single();
        if (ver.error || !ver.data) throw new Error(ver.error?.message ?? "VERSION_NOT_FOUND");
        const q = await scoreScheduleVersion({ collegeId: ver.data.college_id, scheduleVersionId: ITCS_DRAFT_ID, persist: true })
          .catch((e: Error) => { throw new Error(`QUALITY_RUN_FAILED: ${e.message}`); });
        add(`فحص الجودة: ${q.result.total_score} — تعارضات إلزامية ${q.result.hard_conflicts_count}`);
        if (q.result.hard_conflicts_count !== 0) throw new Error("QUALITY_HARD_CONFLICTS");
      }
      const { data, error } = await rpc("itcs_cutover_execute", {
        p_stage: stage, p_version: ITCS_DRAFT_ID, p_published: ITCS_PUBLISHED_ID, p_manifest: manifest,
        p_manifest_sha: server["manifest_sha"], p_expected_published_snapshot: snap.data,
      });
      if (error) throw new Error(error.message);
      add(`PASS ${stage}: ${JSON.stringify(data)}`);
      await serverPreview();
    } catch (e) {
      add(`HOLD — أُلغيت المرحلة ${stage} كاملة: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const structuralOk = !!diff?.ok;
  const repl = (server?.["replacements"] as Repl[] | undefined) ?? [];
  const crossPending = Number(server?.["cross_college_not_applied"] ?? 3);
  const serverOk = !!server && server["missing"] === 0 && server["drift"] === 0 && server["extra"] === 0
    && server["identity_ok"] === true && server["version_status"] === "draft";
  const applied = ((server?.["runs"] as { stage: string }[] | undefined) ?? []).some((r) => r.stage === "applied");

  return (
    <div dir="rtl" className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">انتقال جدول كلية الحاسوب وتقنية المعلومات</h1>
      <Card className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">ارفع ملف {MANIFEST_FILE}</p>
        <input type="file" accept="application/json" aria-label="ملف البيان"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        {errors.length > 0 && (
          <ul className="text-sm text-destructive">{errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </Card>
      {diff && rules && (
        <Card className="grid gap-2 p-4 text-sm md:grid-cols-3">
          <Stat label="مفقودة" v={diff.missing.length} />
          <Stat label="انحراف عن المسودة (محلي)" v={diff.drift.length} />
          <Stat label="زائدة في المسودة" v={diff.extra.length} />
          <Stat label="نظري خارج 08–14" v={rules.theory.length} />
          <Stat label="عملي خارج 08–16" v={rules.lab.length} />
          <Stat label="تعارض قاعات (تقريبي)" v={rules.roomClashes} />
          <Stat label="تعارض طلاب" v={rules.studentClashes} />
          <Stat label="وحدات طلاب فوق 4 أيام" v={rules.overFourDays.length} />
          <Stat label="أيام بمحاضرة واحدة" v={rules.singleDays} />
          <Stat label="بين كليات غير مطبقة (خادم)" v={server ? crossPending : "—"} />
        </Card>
      )}
      {repl.length > 0 && (
        <Card className="p-4 text-sm">
          <h2 className="mb-2 font-semibold">الاستبدالات</h2>
          <ul>{repl.map((r) => <li key={r.replaces}>{r.replaces} — {r.cross_college ? "بين كليات" : "داخلي"} — {r.state}</li>)}</ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!structuralOk || busy} onClick={() => void serverPreview()}>معاينة من الخادم</Button>
        <Button variant="outline" disabled={!serverOk || busy || crossPending === 0} onClick={() => void runStage("requests")}>
          1) إرسال طلبات الكليات الأصلية
        </Button>
        <Button variant="outline" disabled={!serverOk || busy || crossPending !== 0 || applied} onClick={() => void runStage("apply")}>
          2) تطبيق الاستبدالات والنقلات (تبقى مسودة)
        </Button>
        <Button variant="destructive" disabled={!serverOk || busy || !applied} onClick={() => void runStage("publish")}>
          3) فحص الجودة والنشر
        </Button>
      </div>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">سجل العمليات</h2>
        <pre className="whitespace-pre-wrap text-xs">{log.join("\n") || "—"}</pre>
      </Card>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="flex items-center justify-between rounded border p-2">
      <span>{label}</span>
      <Badge variant={v === 0 ? "secondary" : "destructive"}>{v}</Badge>
    </div>
  );
}
